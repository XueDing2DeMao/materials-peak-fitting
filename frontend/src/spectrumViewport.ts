/** 仅计算显示坐标范围，不裁切数据，也不修改分析区间。 */
export function spectrumViewport(traces:Array<Record<string,unknown>>,start:number,end:number,reversed=false){
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)return null;
  let low=Infinity,high=-Infinity;
  for(const trace of traces){
    const x=trace.x as number[]|undefined,y=trace.y as number[]|undefined;
    if(!x||!y)continue;
    for(let i=0;i<x.length;i++)if(x[i]>=start&&x[i]<=end&&Number.isFinite(y[i])){low=Math.min(low,y[i]);high=Math.max(high,y[i]);}
  }
  const padding=(high-low||Math.abs(high)*.1||1)*.08;
  return {x:reversed?[end,start]:[start,end],y:Number.isFinite(low)?[low-padding,high+padding]:undefined};
}
