import type { MultiRequest, MultiPreview, MultiResult } from './multipeakTypes';
import type { Candidate } from './xpsTypes';
const base = import.meta.env.DEV ? "http://127.0.0.1:5176" : "";
async function post<T>(path:string, payload:MultiRequest):Promise<T> {
  const response=await fetch(`${base}/api/multipeak/${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  if(response.status===404||response.status===405)throw new Error('当前后端未提供多峰接口，可能仍在运行旧版本。请重启拟合工具后重新导入数据再试；仅刷新网页不会更新后端。');
  if(!response.ok){const body=await response.json().catch(()=>({detail:'请求失败'}));throw new Error(typeof body.detail==='string'?body.detail:'配置无效，请检查参数、区间和数值');}
  return response.json();
}
export const fitMulti=(p:MultiRequest)=>post<MultiResult>('fit',p);
export const previewMulti=(p:MultiRequest)=>post<MultiPreview>('preview',p);
export const validateMultiInput=(p:MultiRequest)=>post<MultiPreview>('validate',p);
export const candidatesMulti=(p:MultiRequest)=>post<{candidates:Candidate[];note:string}>('candidates',p);
