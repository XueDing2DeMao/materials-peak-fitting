import type {CalculationRequest,CalculationResponse,MethodCatalog,NormalizedAnalysis,PeakMapping,ResultUpload} from './peakRecordTypes';
import type {DatasetRows} from './datasetRows';
const base=import.meta.env.DEV?'http://127.0.0.1:5176':'';
async function call<T>(path:string,options?:RequestInit):Promise<T>{
 const r=await fetch(`${base}${path}`,options);const data=await r.json().catch(()=>null);
 if(!r.ok){const d=data?.detail;throw new Error(typeof d==='string'?d:Array.isArray(d)?d.map((x:any)=>x.msg??x.message??JSON.stringify(x)).join('；'):d?.message??`请求失败 (${r.status})`);}return data as T;
}
const post=<T>(path:string,value:unknown)=>call<T>(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export function uploadPeakResults(file:File,headerRow=1){const data=new FormData();data.append('file',file);return call<ResultUpload>(`/api/peak-results/uploads?header_row=${headerRow}`,{method:'POST',body:data});}
export function loadPeakRows(id:string,sheet:string,offset:number,limit:number,headerRow=1){return call<DatasetRows>(`/api/peak-results/${encodeURIComponent(id)}/rows?${new URLSearchParams({sheet,offset:String(offset),limit:String(limit),header_row:String(headerRow)})}`);}
export const normalizePeakResults=(uploadId:string,mapping:PeakMapping)=>post<NormalizedAnalysis>('/api/peak-results/normalize',{upload_id:uploadId,mapping});
export const adaptFitResult=(payload:{engine:'single'|'multi'|'xps';result:unknown;source?:unknown;mode?:string;metadata?:Record<string,unknown>})=>post<NormalizedAnalysis>('/api/peak-results/from-fit',payload);
export const calculationCatalog=()=>call<MethodCatalog>('/api/peak-calculations/templates');
export const validateCalculation=(request:CalculationRequest)=>post<{valid:boolean;issues:{code:string;message:string;path?:string;record_ids?:string[]}[]}>('/api/peak-calculations/validate',request);
export const evaluateCalculation=(request:CalculationRequest)=>post<CalculationResponse>('/api/peak-calculations/evaluate',request);
