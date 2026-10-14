import type { AnnotatedPeak } from './peakAnnotations';
/** 使用当前显示的线性轴范围；点击空白绘图区也可以选峰，不依赖散点命中。 */
export function pickX(node:HTMLElement,clientX:number,clientY:number):number|null {
  type Axis={_offset:number;_length:number;range:number[]};
  const layout=(node as HTMLElement&{_fullLayout?:{xaxis:Axis;yaxis:Axis}})._fullLayout;
  if(!layout)return null;
  const rect=node.getBoundingClientRect(),x=clientX-rect.left-layout.xaxis._offset,y=clientY-rect.top-layout.yaxis._offset;
  if(x<0||x>layout.xaxis._length||y<0||y>layout.yaxis._length||layout.xaxis._length<=0)return null;
  const [lo,hi]=layout.xaxis.range,value=lo+x/layout.xaxis._length*(hi-lo);
  return Number.isFinite(value)?value:null;
}
/** 按屏幕距离命中峰位线，缩放和倒序轴下均保持 12px 容差；重叠时优先删除后添加的峰。 */
export function nearestPeakAt(node:HTMLElement,clientX:number,clientY:number,peaks:AnnotatedPeak[],start:number,end:number):string|null {
  const x=pickX(node,clientX,clientY);
  if(x===null||x<start||x>end)return null;
  const axis=(node as HTMLElement&{_fullLayout:{xaxis:{_length:number;range:number[]}}})._fullLayout.xaxis;
  const span=Math.abs(axis.range[1]-axis.range[0]);if(!Number.isFinite(span)||!span)return null;
  const visibleStart=Math.max(start,Math.min(...axis.range)),visibleEnd=Math.min(end,Math.max(...axis.range));
  let id:string|null=null,distance=12;
  for(const peak of peaks){
    const center=peak.parameters.xc?.value;
    if(peak.enabled===false||typeof center!=='number'||!Number.isFinite(center)||center<visibleStart||center>visibleEnd)continue;
    const pixels=Math.abs(center-x)*axis._length/span;
    if(pixels<=distance){distance=pixels;id=peak.id;}
  }
  return id;
}
export function estimateClickedPeak(x:number[],y:number[],center:number,start:number,end:number,baseline?:{x:number[];raw_y:number[];baseline:number[]}|null){
  if(!Number.isFinite(center)||center<start||center>end)throw new Error('请在当前拟合区间内点击添加峰');
  const data=baseline??{x,raw_y:y,baseline:y.map(()=>0)};
  if(!data.x.length)throw new Error('请先导入谱线');
  let i=0;for(let j=1;j<data.x.length;j++)if(Math.abs(data.x[j]-center)<Math.abs(data.x[i]-center))i=j;
  const w=(end-start)/10,net=data.raw_y[i]-data.baseline[i];
  return {xc:center,w,A:Math.max(net*w*1.2,1e-8),mu:.35};
}
