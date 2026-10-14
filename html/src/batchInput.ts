import { clone } from './multipeakState';
import { isMulti } from './fitAdapter';
import type { BatchRequest } from './batchTypes';
import type { XpsSource } from './xpsTypes';
export function prepareRequest(template:BatchRequest,data:{x:number[];y:number[]},source:XpsSource|null,fixedBaseline:boolean):BatchRequest {
  const c=clone(template);c.x=[...data.x];c.y=[...data.y];c.source=clone(source);
  if(c.x.length!==c.y.length||c.x.length<4||c.x.some((v,i)=>!Number.isFinite(v)||!Number.isFinite(c.y[i])))throw new Error('当前谱有效数据不足或包含非有限值');
  if(c.x.some((v,i)=>i>0&&v<=c.x[i-1]))throw new Error('X 数据必须递增且不能重复');
  const shifted=isMulti(c)?c.x:c.x.map(x=>x+c.shift_eV);
  if(shifted[0]>c.range_start||shifted.at(-1)!<c.range_end)throw new Error('当前谱不能完整覆盖模板区间');
  if(shifted.filter(v=>v>=c.range_start&&v<=c.range_end).length<4)throw new Error('拟合区间内至少需要 4 个点');
  if(isMulti(c)){
    if(c.baseline.kind!=='none'&&c.baseline.anchors.length&&!fixedBaseline)throw new Error('模板含显式锚点：请选择固定绝对背景，或先用当前谱重新编辑基线');
    c.baseline.confirmed=false;
  }else{
    if(!fixedBaseline){c.background.low_level=null;c.background.high_level=null;}
    c.background.confirmed=false;
  }
  return c;
}
