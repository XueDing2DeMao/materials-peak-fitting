import type { BatchRow } from './batchTypes';
import { resultDiagnostics } from './resultDiagnostics';
import { isMulti } from './fitAdapter';
import { spectrumUnits, quantityUnit } from './spectrumUnits';
/** 前端实验记录；与求解参数分开，不改变计算。 */
export interface ExperimentMetadata { sample_id:string;condition_name:string;condition_value:number|null;condition_unit:string;replicate_id:string }
export type MetadataByTask=Record<string,ExperimentMetadata>;
export const emptyMetadata=():ExperimentMetadata=>({sample_id:'',condition_name:'',condition_value:null,condition_unit:'',replicate_id:''});
export type TrendMetric='position'|'fwhm'|'area_window'|'area_total';
export function trendUnit(row:BatchRow,metric:TrendMetric,fallback:string){
  const request=row.request;
  const units='source' in request?spectrumUnits(isMulti(request)?request.analysis_mode:'xps',request.source):{x:fallback,y:'Y'};
  return quantityUnit(metric,units);
}
/** 近常数序列留出可读坐标范围，避免将浮点尾差放大成实验趋势。 */
export function constantTrendRange(values:(number|null)[]):[number,number]|undefined{
  const finite=values.filter((v):v is number=>v!==null&&Number.isFinite(v));
  if(!finite.length)return;
  const lo=Math.min(...finite),hi=Math.max(...finite),scale=Math.max(Math.abs(lo),Math.abs(hi))||1;
  if(hi-lo<=scale*1e-9)return [lo-scale*.02,hi+scale*.02];
}
export function conditionAxis(metadata:ExperimentMetadata[]){
  const first=metadata[0],name=first?.condition_name.trim(),unit=first?.condition_unit.trim();
  const available=Boolean(metadata.length&&name&&unit&&metadata.every(m=>m.condition_name.trim()===name&&m.condition_unit.trim()===unit&&typeof m.condition_value==='number'&&Number.isFinite(m.condition_value)));
  return {available,label:available?`${name} / ${unit}`:'实验条件',reason:available?'':'全部纳入谱线需填写相同条件名称、单位和有限数值；不自动换算单位。'};
}
export function trendPoints(rows:BatchRow[],peakId:string,metric:TrendMetric,metadata:MetadataByTask,axis:'sequence'|'condition'){
  return rows.map((r,index)=>{
    const attempt=r.attempts.filter(a=>!a.invalidated).at(-1);
    const accepted=Boolean(attempt?.manually_accepted&&attempt.id===r.accepted_attempt_id);
    const valid=['success','review'].includes(r.status)&&r.result&&(!r.attempts.length||attempt?.result===r.result);
    const c=valid?r.result?.components.find(c=>c.id===peakId):null;
    const raw=metric==='position'?c?.peak_geometry?.peak_position:metric==='fwhm'?c?.peak_geometry?.fwhm:metric==='area_window'?c?.area_window:c?.area_total;
    const value=typeof raw==='number'&&Number.isFinite(raw)?raw:null;
    const d=resultDiagnostics(valid?r.result:null,{accepted});
    const status=accepted?`人工接受${d.diagnostic==='有警告'?' · 警告保留':''}`:r.status==='review'?'待复核':r.status==='failed'?'失败':r.status==='skipped'?'已跳过':r.status==='running'?'运行中':!valid?'未计算／已失效':d.diagnostic;
    const symbol=accepted?'diamond':r.status==='review'||d.diagnostic==='有警告'?'triangle-up':r.status==='failed'?'x':r.status==='skipped'?'cross':'circle';
    const m=metadata[r.id]??emptyMetadata();
    return {rowId:r.id,peakId,index:index+1,x:axis==='sequence'?index+1:m.condition_value,value,status,symbol,label:r.label,sample:m.sample_id,replicate:m.replicate_id};
  });
}
