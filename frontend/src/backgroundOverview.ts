export interface OverviewData { x:number[];raw_y:number[];baseline:number[] }
export interface OverviewBounds { xmin:number;xmax:number;ymin:number;ymax:number }
export function overviewBounds(data:OverviewData[]):OverviewBounds|null{
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  for(const d of data)for(let i=0;i<d.x.length;i++){
    if(!Number.isFinite(d.x[i]))continue;
    xmin=Math.min(xmin,d.x[i]);xmax=Math.max(xmax,d.x[i]);
    for(const y of [d.raw_y[i],d.baseline[i]])if(Number.isFinite(y)){ymin=Math.min(ymin,y);ymax=Math.max(ymax,y);}
  }
  return Number.isFinite(xmin)&&Number.isFinite(ymin)?{xmin,xmax,ymin,ymax}:null;
}
/** 仅投影坐标，不平滑、归一化或抽样。 */
export function overviewPoints(x:number[],y:number[],b:OverviewBounds|null,reversed:boolean){
  if(!b)return '';
  return x.flatMap((v,i)=>{
    if(!Number.isFinite(v)||!Number.isFinite(y[i]))return [];
    const dx=(v-b.xmin)/(b.xmax-b.xmin||1);
    return [`${(36+268*(reversed?1-dx:dx)).toFixed(2).replace(/\.00$/,'')},${(112-92*(y[i]-b.ymin)/(b.ymax-b.ymin||1)).toFixed(2)}`];
  }).join(' ');
}
