import {clone} from './multipeakState';
import {fitBatch,isMulti} from './fitAdapter';
import {runFit} from './api';
import {singleRequest,readSingleSettings} from './singleFitAdapter';
import type {AnalysisSnapshot} from './analysisSnapshot';
import type {BatchRequest} from './batchTypes';
export interface FitScenario {id:string;name:string;configuration:BatchRequest;result:AnalysisSnapshot|null;error:string;origin:string;running:boolean}
export async function solveScenario(base:AnalysisSnapshot,configuration:BatchRequest):Promise<AnalysisSnapshot>{
  const request=clone(configuration);
  if(base.engine==='single'){
    if(!isMulti(request))throw new Error('方案类型不匹配');
    return {...clone(base),configuration:request,result:await runFit(singleRequest(request,readSingleSettings(base.singleSettings))),stale:false};
  }
  return {...clone(base),configuration:request,result:await fitBatch(request),stale:false};
}
export async function calculateScenario(item:FitScenario,base:AnalysisSnapshot,solve=solveScenario){
  item.running=true;item.error='';
  try{item.result=await solve(clone(base),clone(item.configuration));}
  catch(e){item.result=null;item.error=e instanceof Error?e.message:String(e);}
  finally{item.running=false;}
}
