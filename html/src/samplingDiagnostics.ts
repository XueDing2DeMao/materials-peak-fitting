import type { PeakGeometry } from './peakGeometry';
export function samplingDiagnostics(x:number[],g?:PeakGeometry){
  const lo=g?.halfmax_low,hi=g?.halfmax_high;
  if(!g||g.fwhm==null||!Number.isFinite(g.fwhm)||g.fwhm<=0||lo==null||hi==null||!Number.isFinite(lo)||!Number.isFinite(hi)||lo>=hi)
    return {count:null,minimum:null,median:null,maximum:null,extrapolated:null,reason:'缺少有效整体峰宽或半高点，无法计算采样支持。'};
  const observed=x.filter(Number.isFinite).sort((a,b)=>a-b),local=observed.filter(v=>v>=lo&&v<=hi);
  const gaps=local.slice(1).map((v,i)=>v-local[i]).filter(v=>v>0).sort((a,b)=>a-b),n=gaps.length;
  return {count:local.length,minimum:n?gaps[0]:null,median:n?(gaps[Math.floor((n-1)/2)]+gaps[Math.floor(n/2)])/2:null,maximum:n?gaps[n-1]:null,
    extrapolated:observed.length?lo<observed[0]||hi>observed.at(-1)!:null,reason:n?'':'半高区间内不足两个不同观测坐标，无法计算局部间隔。'};
}
