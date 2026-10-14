import { fitMulti } from './multipeakApi';
import { fitXps } from './xpsApi';
import { clone } from './multipeakState';
import type { BatchRequest, BatchResult } from './batchTypes';
import type { MultiRequest } from './multipeakTypes';
import { hasCorrelatedResiduals } from './resultDiagnostics';

export const isMulti=(request:BatchRequest):request is MultiRequest=>'analysis_mode' in request;
export const fitBatch=(request:BatchRequest):Promise<BatchResult>=>isMulti(request)?fitMulti(request):fitXps(request);
export function topology(request:BatchRequest):string{
  return JSON.stringify([isMulti(request)?request.analysis_mode:'xps',request.components.map(c=>[c.id,c.model,c.enabled]),request.constraints]);
}
export function inheritParameters(current:BatchRequest,previous:BatchResult):BatchRequest {
  if(topology(current)!==topology(previous.configuration))throw new Error('峰 ID、模型或约束不一致，不能继承');
  if(!isMulti(current)&&!isMulti(previous.configuration)&&current.shift_eV!==previous.configuration.shift_eV)throw new Error('能量校准位移变化，请从模板重新开始');
  const next=clone(current);
  // 只写入自由根变量；绑定值按当前谱的约束重新展开。
  const targets=new Map(next.constraints.map(c=>[`${c.target.component}.${c.target.parameter}`,c]));
  for(const c of next.components){if(!c.enabled)continue;
    const prior=previous.components.find(p=>p.id===c.id);if(!prior)throw new Error('上一条缺少对应峰');
    for(const [name,p] of Object.entries(c.parameters)){
      if(!p||p.fixed||targets.has(`${c.id}.${name}`))continue;
      const value=prior.parameters[name]?.value;if(!Number.isFinite(value))throw new Error('上一条含不可用参数');p.value=value;
    }
  }
  const parameter=(id:string,name:string)=>Object.entries(next.components.find(c=>c.id===id)!.parameters).find(([n])=>n===name)![1]!;
  function resolve(id:string,name:string,visited=new Set<string>()):number{
    const key=`${id}.${name}`;if(visited.has(key))throw new Error('约束存在循环');
    const p=parameter(id,name),link=targets.get(key);if(!link)return p.value;
    const source=resolve(link.source.component,link.source.parameter,new Set([...visited,key]));
    return link.kind==='offset'?source+link.value:source*link.value;
  }
  for(const link of next.constraints){const p=parameter(link.target.component,link.target.parameter);if(!p.fixed)p.value=resolve(link.target.component,link.target.parameter);}
  return next;
}
export function inheritanceWarnings(result:BatchResult,request:BatchRequest):string[]{
  const warnings:string[]=[];
  if(hasCorrelatedResiduals(result.diagnostics.lag1_correlation))warnings.push('残差具有明显相邻相关性，需复核后再继承');
  if(!result.diagnostics.identifiable)warnings.push('峰分量不可独立辨识');
  if(result.diagnostics.bound_parameters.length)warnings.push('存在贴边参数');
  if(result.diagnostics.strong_correlations.length)warnings.push('存在强参数相关');
  if(result.diagnostics.warnings.some(w=>w.includes('弱尾')))warnings.push('EMG 弱尾参数需要复核');
  const centers=request.components.filter(c=>c.enabled).map(c=>({id:c.id,initial:c.parameters.xc!.value,fitted:result.components.find(p=>p.id===c.id)?.parameters.xc?.value}));
  if(centers.some(c=>!Number.isFinite(c.fitted)))warnings.push('峰位不可用');
  for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++){
    const a=centers[i],b=centers[j];if((a.initial-b.initial)*(a.fitted!-b.fitted!)<=0)warnings.push('峰位次序变化或重合，峰身份待复核');
  }
  return [...new Set(warnings)];
}
