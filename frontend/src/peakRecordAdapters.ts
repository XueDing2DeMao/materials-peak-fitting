import type {PeakField,PeakQuantity,PeakRecord,NormalizedAnalysis} from './peakRecordTypes';
export const FIELD_LABELS:Record<PeakField,string>={position:'峰位',width:'峰宽',height:'峰高',area:'积分面积'};
export const TECHNIQUE_LABELS={general:'通用',xrd:'XRD',raman:'Raman',ftir:'FTIR',xps:'XPS'};
export const quantityText=(q:PeakQuantity|undefined)=>q?.value==null?'未提供／不可用':`${Number(q.value.toPrecision(8))}${q.unit&&q.unit!=='unknown'?` ${q.unit}`:'（单位未知）'}`;
export const recordIdentity=(r:PeakRecord)=>r.id;
export function emptyAnalysis():NormalizedAnalysis{return {schema_version:1,records:[],spectra:[],issues:[]};}
export const definitionLabel=(value:string|null|undefined)=>({fwhm:'半高全宽 FWHM',hwhm:'半高半宽 HWHM',sigma:'Gaussian σ',two_theta:'2θ',apex:'峰顶',model_position:'模型位置参数',centroid:'质心',height:'背景以上峰高',total:'全域积分',range:'区间积分',unknown:'定义未知'}[value??'']??value??'定义未知');
