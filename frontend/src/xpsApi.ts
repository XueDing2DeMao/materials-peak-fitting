import type { Candidate, XpsPreview, XpsRequest, XpsResult } from "./xpsTypes";

const base = import.meta.env.DEV ? "http://127.0.0.1:5176" : "";
async function post(path:string,payload:unknown):Promise<Response> {
  const response=await fetch(`${base}/api/xps/${path}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
  if(!response.ok){
    const error=await response.json().catch(()=>({detail:"请求失败"}));
    const detail=typeof error.detail==="string"?error.detail:Array.isArray(error.detail)?error.detail.map((e:{loc:string[];msg:string})=>`${e.loc.slice(1).join(".")}: ${e.msg}`).join("；"):"参数无效";
    throw new Error(detail);
  }
  return response;
}
export async function fitXps(request:XpsRequest):Promise<XpsResult>{return (await post("fit",request)).json();}
export async function previewXps(request:XpsRequest):Promise<XpsPreview>{return (await post("background-preview",request)).json();}
export async function candidatesXps(request:XpsRequest):Promise<{candidates:Candidate[];note:string}>{return (await post("candidates",request)).json();}
export async function exportXps(kind:"curves"|"parameters"|"configuration",request:XpsRequest):Promise<Blob>{return (await post("export",{kind,request})).blob();}
