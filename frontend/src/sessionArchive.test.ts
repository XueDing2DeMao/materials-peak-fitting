import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {readSession,writeSession,normalizedBatchRows,type SingleSession,type BatchSession} from './sessionArchive';
import {emptyMetadata} from './batchTrend';
const fixture=()=>JSON.parse(readFileSync('../examples/public/results/xps-result.json','utf8'));
function single():SingleSession{const r=fixture();return {kind:'single',configuration:structuredClone(r.configuration),result:{engine:'xps',configuration:r.configuration,result:r,stale:false}};}
function batch():BatchSession{
  const r=fixture(),request=structuredClone(r.configuration),attempt:any={id:'attempt-1',initialization_source:'template',parent_task_id:null,parent_attempt_id:null,request,result:r,error:'',warnings:[],manually_accepted:true,invalidated:false};
  return {kind:'batch',template:request,batch_id:'batch-1',status:'running',sequential:true,rows:[{id:'row-1',label:'原谱',request,result:r,status:'success',accepted_attempt_id:'attempt-1',attempts:[attempt]},{id:'row-2',label:'中断',request:structuredClone(request),result:null,status:'running',accepted_attempt_id:null,attempts:[{...structuredClone(attempt),id:'attempt-2',result:null,manually_accepted:false}]}],metadata:{'row-1':emptyMetadata(),'row-2':emptyMetadata()},audits:{}};
}
describe('独立本地会话格式',()=>{
  it('连续计算后待复核或失败条目可位于成功条目前，保存恢复不自动接受',()=>{
    for(const status of ['review','failed'] as const){
      const w=batch();w.status='done';w.rows[1]={...structuredClone(w.rows[0]),id:'row-2',accepted_attempt_id:'attempt-2',attempts:[{...structuredClone(w.rows[0].attempts[0]),id:'attempt-2'}]};
      w.rows[0].status=status;w.rows[0].accepted_attempt_id=null;w.rows[0].attempts[0].manually_accepted=false;
      const rows=normalizedBatchRows((readSession(writeSession(w)).workspace as BatchSession).rows);
      expect(rows.map(r=>r.status)).toEqual([status,'success']);expect(rows[0].attempts[0].manually_accepted).toBe(false);
    }
    const pending=batch();pending.rows[0].status='pending';pending.rows[1].status='success';expect(()=>normalizedBatchRows(pending.rows)).toThrow('未完成');
  });
  it('拒绝越界求解设置、循环约束和不一致的结果配置',()=>{
    const a=single();a.configuration.solver.max_nfev=0;expect(()=>writeSession(a)).toThrow('求解设置');
    const b=single();b.configuration.constraints.push({source:{component:'p1',parameter:'xc'},target:{component:'p1',parameter:'xc'},kind:'offset',value:0});expect(()=>writeSession(b)).toThrow('自引用');
    const c=single();c.result!.configuration=structuredClone(c.result!.configuration);c.result!.configuration.solver.max_nfev+=1;expect(()=>writeSession(c)).toThrow('配置快照');
  });
  it('单谱结果与配置完整往返，不依赖 dataset_id 或网络',()=>{const w=single(),text=writeSession(w),a=readSession(text);expect(a.workspace).toEqual(w);expect(a.read_only).toBe(false);expect(text).not.toContain('dataset_id');});
  it('损坏、旧追溯格式、未知版本和观察值错配均拒绝，不改变原对象',()=>{
    const w=single(),original=JSON.stringify(w),a=JSON.parse(writeSession(w));
    expect(()=>readSession('{')).toThrow();expect(()=>readSession('{"template_version":2,"rows":[]}')).toThrow();
    expect(()=>readSession(JSON.stringify({...a,session_version:2}))).toThrow('版本');
    a.workspace.result.result.raw_y[0]+=1;expect(()=>readSession(JSON.stringify(a))).toThrow('观测');expect(JSON.stringify(w)).toBe(original);
  });
  it('显式缺失原谱只读，配置数据与原结果来源不一致不能恢复',()=>{
    const w=single();w.configuration.x=[];w.configuration.y=[];w.result!.configuration.x=[];w.result!.configuration.y=[];
    expect(readSession(writeSession(w)).read_only).toBe(true);
    w.configuration.source!.file_sha256='0'.repeat(64);expect(()=>writeSession(w)).toThrow('身份');
  });
  it('批次人工接受往返，未完成任务重置为待执行并保留中断记录',()=>{
    const a=readSession(writeSession(batch()));expect(a.read_only).toBe(false);
    const rows=normalizedBatchRows((a.workspace as BatchSession).rows);expect(rows[0].result).toBe(rows[0].attempts[0].result);expect(rows[0].attempts[0].manually_accepted).toBe(true);
    expect(rows[1].status).toBe('pending');expect(rows[1].attempts[0].invalidated).toBe(true);expect(rows[1].attempts[0].error).toContain('未完成');
  });
  it('重复任务、非法继承、未确认警告结果和超限任务拒绝',()=>{
    const w=batch();w.rows[1].id=w.rows[0].id;expect(()=>writeSession(w)).toThrow('重复');
    const x=batch();x.rows[0].attempts[0].parent_attempt_id='不存在';expect(()=>writeSession(x)).toThrow('继承');
    const y=batch();y.rows[0].attempts[0].manually_accepted=false;expect(()=>writeSession(y)).toThrow('人工接受');
    const z=batch();z.rows=Array.from({length:101},()=>z.rows[0]);expect(()=>writeSession(z)).toThrow('批次任务');
  });
  it('过期结果标记保留；跳过后不生成虚假的获准结果',()=>{
    const w=single();w.result!.stale=true;expect((readSession(writeSession(w)).workspace as SingleSession).result?.stale).toBe(true);
    const b=batch();b.rows[0].status='skipped';b.rows[0].accepted_attempt_id=null;const rows=normalizedBatchRows((readSession(writeSession(b)).workspace as BatchSession).rows);expect(rows[0].status).toBe('skipped');expect(rows[0].accepted_attempt_id).toBeNull();
  });
});
