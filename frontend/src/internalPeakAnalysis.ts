import type {SingleSession,BatchSession} from './sessionArchive';
import type {NormalizedAnalysis} from './peakRecordTypes';
import {adaptFitResult} from './peakResultImportApi';
import {mergeAnalyses} from './peakResultImportState';
import {isMulti} from './fitAdapter';
import type {BatchRequest,BatchRow} from './batchTypes';

const analysisMode=(config:BatchRequest)=>isMulti(config)?config.analysis_mode:'xps';
/** 会话恢复后结果对象可能已克隆，按内容核对当前尝试。 */
export function usableBatchResult(row:BatchRow){
 const attempt=row.attempts.filter(a=>!a.invalidated).at(-1);
 return Boolean(row.result&&['success','review'].includes(row.status)&&(!row.attempts.length||(attempt?.result&&JSON.stringify(attempt.result)===JSON.stringify(row.result))));
}
/** 只读取当前有效快照；二次计算入口不会重新求解或改变原工作区。 */
export async function analysisFromSession(workspace:SingleSession|BatchSession):Promise<NormalizedAnalysis>{
  if(workspace.kind==='single'){
    const s=workspace.result;
    if(!s)throw new Error('请先完成拟合，再计算材料参数。');
    if(s.stale)throw new Error('当前拟合结果已失效，请重新拟合后再计算材料参数。');
    return adaptFitResult({engine:s.engine,result:s.result,source:s.configuration.source,mode:analysisMode(s.configuration),
      metadata:{manually_accepted:s.accepted??false,fit_status:'converged' in s.result&&s.result.converged?'converged':'review'}});
  }
  let analysis:NormalizedAnalysis|null=null;
  let skipped=0;
  for(const row of workspace.rows){
    const attempt=row.attempts.filter(a=>!a.invalidated).at(-1);
    if(!usableBatchResult(row)){
      skipped++;continue;
    }
    const config=row.result!.configuration;
    const imported=await adaptFitResult({engine:isMulti(config)?'multi':'xps',result:row.result,source:config.source,mode:analysisMode(config),metadata:{
      ...workspace.metadata[row.id],batch_id:workspace.batch_id,task_id:row.id,attempt_id:attempt?.id??null,
      manually_accepted:Boolean(attempt?.manually_accepted&&row.accepted_attempt_id===attempt.id),fit_status:row.status,
    }});
    analysis=mergeAnalyses(analysis,imported);
  }
  if(!analysis)throw new Error('请先完成拟合；当前批次没有可用且未失效的结果。');
  if(skipped)analysis.issues.push({code:'skipped_fit_results',severity:'warning',message:`有 ${skipped} 条未完成或已失效的谱线未纳入材料参数计算。`});
  return analysis;
}
