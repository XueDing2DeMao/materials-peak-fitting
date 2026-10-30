import { describe, expect, it, vi } from 'vitest';
import { addMultiComponent, clone, createMultiConfig } from './multipeakState';
import type { MultiRequest, MultiResult } from './multipeakTypes';

const request=()=>{const c=createMultiConfig([0,1,2,3,4],[0,1,3,1,0],null,'general');c.baseline.kind='none';addMultiComponent(c);c.components[0].parameters.w!.fixed=true;return c;};
function result(c:MultiRequest,xc=2.1,converged=true):MultiResult{
  return {configuration:clone(c),converged,message:converged?'ok':'The maximum number of function evaluations is exceeded.',evaluations:converged?4:c.solver.max_nfev,
    components:c.components.map(p=>({id:p.id,label:p.label,model:p.model,parameters:Object.fromEntries(Object.entries(p.parameters).map(([n,v])=>[n,{...v!,value:n==='xc'?xc:v!.value,standard_error:null,uncertainty_reason:null,linked_to:null,bound:false}])),y:[0,1,3,1,0],area_total:1,area_window:1,area_fraction_window:1,height:3,fwhm:1})),
    x:c.x,raw_y:c.y,baseline:c.x.map(()=>0),residuals:c.x.map(()=>0),total_y:c.y,groups:[],data_sha256:'a',statistics:{rmse:0,free_parameters:3},computed_only:false,statistics_definition:{},baseline_configuration:{...c.baseline,resolved_anchors:[]},
    diagnostics:{identifiable:true,uncertainty_available:true,jacobian_rank:3,scaled_condition:1,bound_parameters:[],strong_correlations:[],lag1_correlation:0,warnings:[]}};
}
async function runner(){const m=import.meta.glob('./batchRunner.ts');expect(m['./batchRunner.ts']).toBeDefined();return await m['./batchRunner.ts']() as typeof import('./batchRunner');}
describe('批量顺序优化',()=>{
  it('恢复不执行，获准父结果重建；跳过和重跑不恢复旧继承链',async()=>{
    const {BatchRunner}=await runner();
    for(const state of ['accepted','skipped','rewound'] as const){
      let original!:InstanceType<typeof BatchRunner>;
      const fit=vi.fn(async(c:any)=>{original.pause();return result(c,2.4);});
      original=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);
      await original.start();
      if(state==='skipped'){original.rows[0].status='skipped';original.rows[0].accepted_attempt_id=null;}
      if(state==='rewound'){original.status='paused';original.index=1;original.rows[1].attempts=[{...clone(original.rows[0].attempts[0]),id:'old-b'}];original.rewind(1,request());}
      const resumedFit=vi.fn(async(c:any)=>result(c));
      const restored=BatchRunner.restore(clone(original.rows),original.id,true,resumedFit);
      expect(restored.status).toBe('paused');expect(resumedFit).not.toHaveBeenCalled();
      await restored.start();expect(restored.rows[1].attempts.at(-1)?.initialization_source).toBe(state==='accepted'?'previous_result':'template');
      expect(resumedFit.mock.calls[0][0].components[0].parameters.xc.value).toBe(state==='accepted'?2.4:2);
    }
  });
  it('显著残差相关不暂停，警告保持待复核，历史接受或跳过不改写下游',async()=>{
    const {BatchRunner}=await runner();
    for(const decision of ['accept','skip'] as const){
      let n=0;const fit=vi.fn(async(c:any)=>{const r=result(c,2.4);if(!n++)r.diagnostics.lag1_correlation=-.7;return r;});
      const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();
      expect(run.status).toBe('done');expect(fit).toHaveBeenCalledTimes(2);expect(run.rows[0].status).toBe('review');expect(run.rows[0].accepted_attempt_id).toBeNull();
      run[decision](0);await run.start();expect(run.rows[0].attempts[0].warnings.join()).toContain('残差');
      expect(run.rows[0].attempts[0].manually_accepted).toBe(decision==='accept');
      expect(run.rows[1].attempts[0].initialization_source).toBe('template');expect(run.index).toBe(2);expect(run.status).toBe('done');expect(fit).toHaveBeenCalledTimes(2);
    }
  });
  it('通用标准误口径和阈值边界不阻断正常批次',async()=>{
    const {BatchRunner}=await runner();const fit=async(c:any)=>{const r=result(c);r.diagnostics.lag1_correlation=.5;r.diagnostics.warnings=['标准误仅在当前固定背景、模型及约束下成立，不含背景选择误差'];return r;};
    const run=new BatchRunner([{id:'a',label:'a',request:request()}],fit);await run.start();expect(run.status).toBe('done');
  });
  it('上一条最终值作为下一条初值，固定参数不覆盖且原模板不变',async()=>{
    const {BatchRunner}=await runner(),a=request(),b=request(),fit=vi.fn(async(c:any)=>result(c,2.2));
    const run=new BatchRunner([{id:'a',label:'a',request:a},{id:'b',label:'b',request:b}],fit);await run.start();
    expect(fit.mock.calls[1][0].components[0].parameters.xc.value).toBe(2.2);
    expect(fit.mock.calls[1][0].components[0].parameters.w.value).toBe(b.components[0].parameters.w!.value);
    expect(a.components[0].parameters.xc!.value).toBe(2);expect(run.rows[1].attempts[0].parent_task_id).toBe('a');expect(run.status).toBe('done');
  });
  it('耗尽预算只续算一次，再回退模板；失败保留且继续下一谱',async()=>{
    const {BatchRunner}=await runner(),fit=vi.fn(async(c:any)=>result(c,2.3,false));
    const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();
    expect(fit).toHaveBeenCalledTimes(6);expect(run.status).toBe('done');expect(run.rows.map(r=>r.status)).toEqual(['failed','failed']);
    expect(run.rows[0].attempts.map(a=>a.initialization_source)).toEqual(['template','continuation','template']);
    expect(fit.mock.calls[3][0].components[0].parameters.xc.value).toBe(2);expect(run.rows[1].attempts[0].parent_task_id).toBeNull();
  });
  it('秩不足不阻塞后续计算，异常结果不自动接受也不继承',async()=>{
    const {BatchRunner}=await runner();let n=0;
    const fit=vi.fn(async(c:any)=>{const r=result(c);if(!n++)r.diagnostics.identifiable=false;return r;});
    const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();
    expect(fit).toHaveBeenCalledTimes(2);expect(run.rows[0].status).toBe('review');expect(run.rows[0].attempts[0].manually_accepted).toBe(false);expect(run.rows[1].attempts[0].initialization_source).toBe('template');expect(run.status).toBe('done');
  });
  it('恢复旧暂停批次时跳过已计算待复核条目，从后续待执行条目继续',async()=>{
    const {BatchRunner}=await runner();let original!:InstanceType<typeof BatchRunner>;
    original=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],async(c:any)=>{original.pause();const r=result(c);r.diagnostics.identifiable=false;return r;});
    await original.start();expect(original.status).toBe('paused');expect(original.index).toBe(1);
    const fit=vi.fn(async(c:any)=>result(c)),restored=BatchRunner.restore(clone(original.rows),original.id,true,fit);
    await restored.start();expect(fit).toHaveBeenCalledTimes(1);expect(restored.rows[0].status).toBe('review');expect(restored.rows[1].attempts[0].initialization_source).toBe('template');
    expect(BatchRunner.restore(clone(restored.rows),original.id,true,fit).status).toBe('done');
  });
  it('请求异常重试有界，保留失败记录并继续下一条',async()=>{
    const {BatchRunner}=await runner();let n=0;const fit=vi.fn(async(c:any)=>{if(n++<2)throw new Error('求解失败');return result(c);});
    const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();
    expect(run.rows.map(r=>r.status)).toEqual(['failed','success']);expect(run.rows[0].attempts).toHaveLength(2);expect(run.rows[1].attempts[0].initialization_source).toBe('template');expect(run.status).toBe('done');
  });
  it('继承不可用时保留错误记录，当前谱回退模板后仍继续',async()=>{
    const {BatchRunner}=await runner();let n=0;
    const fit=vi.fn(async(c:any)=>{const r=result(c);if(!n++)delete r.components[0].parameters.A;return r;});
    const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();
    expect(fit).toHaveBeenCalledTimes(2);expect(run.status).toBe('done');expect(run.rows[1].attempts[0].error).toContain('回退模板');expect(run.rows[1].attempts[1].initialization_source).toBe('template');expect(run.rows[1].attempts[1].parent_task_id).toBeNull();
  });
  it.each(['pause','stop'] as const)('有警告返回时仍尊重用户%s，复核最新前驱后才允许继承',async control=>{
    const {BatchRunner}=await runner();let resolve!:(r:MultiResult)=>void;
    const c=request(),fit=vi.fn(()=>new Promise<MultiResult>(r=>resolve=r));
    const run=new BatchRunner([{id:'a',label:'a',request:c},{id:'b',label:'b',request:c}],fit),pending=run.start();
    run[control]();const warning=result(c,2.4);warning.diagnostics.identifiable=false;resolve(warning);await pending;
    expect(run.status).toBe(control==='pause'?'paused':'stopped');expect(run.index).toBe(1);expect(fit).toHaveBeenCalledTimes(1);
    run.accept(0);const resumed=run.start();expect(run.rows[1].attempts[0].initialization_source).toBe('previous_result');resolve(result(c));await resumed;
    expect(run.status).toBe('done');
  });
  it('暂停等待当前请求结束，不抢跑下一条',async()=>{
    const {BatchRunner}=await runner();let resolve!:(v:MultiResult)=>void;
    const fit=vi.fn(()=>new Promise<MultiResult>(r=>resolve=r));
    const c=request(),run=new BatchRunner([{id:'a',label:'a',request:c},{id:'b',label:'b',request:c}],fit);
    const pending=run.start();run.pause();resolve(result(c));await pending;expect(run.status).toBe('paused');expect(fit).toHaveBeenCalledTimes(1);
  });
  it.each(['pause','stop'] as const)('最后一条期间%s，返回后显示计算已结束',async control=>{
    const {BatchRunner}=await runner();let run!:InstanceType<typeof BatchRunner>;
    run=new BatchRunner([{id:'a',label:'a',request:request()}],async(c:any)=>{run[control]();const r=result(c);r.diagnostics.identifiable=false;return r;});
    await run.start();expect(run.rows[0].status).toBe('review');expect(run.status).toBe('done');
  });
  it('重跑上游时保留历史但撤销下游有效结果',async()=>{
    const {BatchRunner}=await runner(),fit=vi.fn(async(c:any)=>result(c));
    const run=new BatchRunner([{id:'a',label:'a',request:request()},{id:'b',label:'b',request:request()}],fit);await run.start();run.rewind(0,request());
    expect(run.rows[1].status).toBe('pending');expect(run.rows[1].result).toBeNull();expect(run.rows[1].attempts[0].invalidated).toBe(true);
  });
  it('未收敛返回前停止，不续算也不启动后继',async()=>{
    const {BatchRunner}=await runner();let resolve!:(v:MultiResult)=>void;
    const fit=vi.fn(()=>new Promise<MultiResult>(r=>resolve=r)),c=request();
    const run=new BatchRunner([{id:'a',label:'a',request:c},{id:'b',label:'b',request:c}],fit);
    const pending=run.start();run.stop();resolve(result(c,2.2,false));await pending;
    expect(run.status).toBe('stopped');expect(fit).toHaveBeenCalledTimes(1);expect(run.rows[1].status).toBe('pending');
  });
});
