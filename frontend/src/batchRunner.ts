/** 当前会话的顺序执行器；暂停/停止在当前 HTTP 求解返回后生效。 */
import { clone } from './multipeakState';
import { validateBatchUnits } from './batchInput';
import { fitBatch, inheritParameters, inheritanceWarnings, topology } from './fitAdapter';
import type { BatchInput, BatchRow, BatchAttempt, BatchRequest, BatchResult } from './batchTypes';

export class BatchRunner {
  rows:BatchRow[];
  status:'ready'|'running'|'pausing'|'paused'|'stopping'|'stopped'|'done'='ready';
  index=0;
  private executing=false;
  private parent:{row:BatchRow;attempt:BatchAttempt}|null=null;
  constructor(inputs:BatchInput[],private fit:(p:BatchRequest)=>Promise<BatchResult>=fitBatch,readonly sequential=true,readonly id:string=crypto.randomUUID()){
    if(!inputs.length||inputs.length>100)throw new Error('批次需要 1—100 条谱线');
    for(const row of inputs)validateBatchUnits(row.request);
    if(new Set(inputs.map(r=>r.id)).size!==inputs.length)throw new Error('任务 ID 不能重复');
    if(inputs.some(r=>topology(r.request)!==topology(inputs[0].request)))throw new Error('同批次的峰模型和约束必须一致');
    this.rows=clone(inputs).map(row=>({...row,status:'pending',attempts:[],result:null,accepted_attempt_id:null}));
  }
  /** rows 已由会话读取器完整校验和中断归一化；恢复不发送计算请求。 */
  static restore(rows:BatchRow[],id:string,sequential:boolean,fit?:(p:BatchRequest)=>Promise<BatchResult>){
    const runner=new BatchRunner(rows,fit,sequential,id);
    runner.rows=rows;
    runner.index=rows.findIndex(row=>row.status==='pending');
    if(runner.index<0)runner.index=rows.length;
    runner.status=runner.index===rows.length?'done':'paused';
    const previous=rows[runner.index-1],current=rows[runner.index];
    // 重跑主动切断旧继承链；中断请求则仍从最后有效的获准结果开始。
    const rewound=current?.attempts.length&&current.attempts.every(a=>a.invalidated)&&!current.attempts.some(a=>a.error.includes('保存时请求未完成'));
    const accepted=previous?.attempts.find(a=>a.id===previous.accepted_attempt_id&&!a.invalidated&&a.result?.converged);
    if(!rewound&&previous?.status==='success'&&accepted)runner.parent={row:previous,attempt:accepted};
    return runner;
  }
  pause(){if(this.executing)this.status='pausing';}
  stop(){if(this.executing)this.status='stopping';else this.status='stopped';}
  async start(){
    if(this.executing||this.index>=this.rows.length)return;
    this.executing=true;this.status='running';
    try{
      while(this.status==='running'&&this.index<this.rows.length){
        const row=this.rows[this.index];
        // 兼容旧会话暂停在待复核条目的游标；复核状态不阻塞计算队列。
        if(row.status!=='pending'){this.parent=null;this.index++;continue;}
        row.status='running';row.accepted_attempt_id=null;
        let request=clone(row.request),source:BatchAttempt['initialization_source']='template',parentTask:string|null=null,parentAttempt:string|null=null;
        if(this.sequential&&this.parent){
          try{request=inheritParameters(request,this.parent.attempt.result!);source='previous_result';parentTask=this.parent.row.id;parentAttempt=this.parent.attempt.id;}
          catch(e){row.attempts.push(this.record(row,request,'template',null,null,`继承初值失败，已回退模板：${String(e)}`));this.parent=null;request=clone(row.request);}
        }
        let continued=false,fallenBack=false;
        while(true){
          const attempt=this.record(row,request,source,parentTask,parentAttempt);row.attempts.push(attempt);
          try{
            attempt.result=await this.fit(clone(request));row.result=attempt.result;
            if(!Number.isFinite(attempt.result.statistics.rmse)||attempt.result.components.some(c=>Object.values(c.parameters).some(p=>!Number.isFinite(p.value))))throw new Error('结果包含非有限参数或残差');
            attempt.warnings=inheritanceWarnings(attempt.result,request);
            if(attempt.result.converged){
              row.status=attempt.warnings.length?'review':'success';
              if(row.status==='success'){row.accepted_attempt_id=attempt.id;this.parent={row,attempt};}
              break;
            }
            attempt.error=attempt.result.message;
          }catch(e){attempt.error=e instanceof Error?e.message:String(e);}
          if(this.status!=='running'){row.status='failed';break;}
          if(attempt.result&&!attempt.result.converged&&attempt.result.evaluations>=request.solver.max_nfev&&!continued&&!fallenBack){
            continued=true;
            try{request=inheritParameters(row.request,attempt.result);source='continuation';parentTask=row.id;parentAttempt=attempt.id;continue;}
            catch(e){attempt.error+=`；续算初值不可用：${String(e)}`;}
          }
          if(!fallenBack){fallenBack=true;request=clone(row.request);source='template';parentTask=null;parentAttempt=null;continue;}
          row.status='failed';break;
        }
        // 保留警告和失败记录，但不将未获准参数传递给下一谱。
        if(row.status!=='success')this.parent=null;
        this.index++;
        const pendingStatus=String(this.status);
        if(pendingStatus==='stopping'){this.status='stopped';break;}
        if(pendingStatus==='pausing'){this.status='paused';break;}
      }
      if(this.index>=this.rows.length)this.status='done';
    }finally{this.executing=false;}
  }
  private record(row:BatchRow,request:BatchRequest,source:BatchAttempt['initialization_source'],parent_task_id:string|null,parent_attempt_id:string|null,error=''):BatchAttempt {
    return {id:`${this.id}:${row.id}:${row.attempts.length+1}`,request:clone(request),initialization_source:source,parent_task_id,parent_attempt_id,result:null,error,warnings:[],manually_accepted:false,invalidated:false};
  }
  accept(index=this.index){
    const row=this.rows[index],attempt=row?.attempts.at(-1);
    if(this.executing||!attempt?.result?.converged||row.status!=='review')return;
    attempt.manually_accepted=true;row.status='success';row.accepted_attempt_id=attempt.id;
    // 事后复核不重写下游结果或倒退游标；只有紧邻的前驱可影响尚未执行的下一谱。
    if(index===this.index-1&&this.rows[this.index]?.status==='pending')this.parent={row,attempt};
  }
  skip(index=this.index){
    const row=this.rows[index];if(this.executing||!row||!['pending','review','failed'].includes(row.status))return;
    row.status='skipped';row.accepted_attempt_id=null;
    if(index===this.index-1)this.parent=null;
    if(index===this.index){this.parent=null;this.index++;this.status=this.index===this.rows.length?'done':'paused';}
  }
  rewind(index:number,request:BatchRequest){
    if(this.executing||index<0||index>=this.rows.length)throw new Error('请先暂停当前谱');
    validateBatchUnits(request);
    if(topology(request)!==topology(this.rows[index].request))throw new Error('修改峰数或模型请建立新批次');
    this.rows[index].request=clone(request);
    for(const row of this.rows.slice(index)){row.status='pending';row.result=null;row.accepted_attempt_id=null;for(const attempt of row.attempts)attempt.invalidated=true;}
    this.index=index;this.parent=null;this.status='paused';
  }
}
