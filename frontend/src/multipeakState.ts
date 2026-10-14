import type { PeakModel } from './types';
import type { Candidate, XpsSource } from './xpsTypes';
import { PEAK_MODEL_PARAMETERS, type PeakParameterName } from './peakModels';
import type { MultiMode, MultiRequest, MultiComponent, MultiPreview } from './multipeakTypes';

export const clone = <T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function createMultiConfig(x:number[],y:number[],source:XpsSource|null,analysis_mode:MultiMode):MultiRequest {
  const range_start=x.length?Math.min(...x):0,range_end=x.length?Math.max(...x):1;
  return {schema_version:1,analysis_mode,x:[...x],y:[...y],source:clone(source),range_start,range_end,
    baseline:{kind:'line',anchors:[],degree:2,smoothing:0,confirmed:false},components:[],constraints:[],solver:{max_nfev:3000,tolerance:1e-9}};
}
export function addMultiComponent(config:MultiRequest,candidate?:Partial<Candidate>,preview?:MultiPreview|null,model:PeakModel=config.components[0]?.model??'psd_voigt1'):MultiComponent {
  if(config.components.length>=40)throw new Error('最多添加 40 个峰');
  const points=config.x.map((x,i)=>({x,y:config.y[i]})).filter(p=>p.x>=config.range_start&&p.x<=config.range_end);
  if(points.length<4)throw new Error('当前区间至少需要 4 个点');
  let best=0;for(let i=1;i<points.length;i++)if(points[i].y>points[best].y)best=i;
  const width=(config.range_end-config.range_start)/10;
  const net=preview?Math.max(...preview.raw_y.map((y,i)=>y-preview.baseline[i])):Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));
  let id=1;while(config.components.some(c=>c.id===`p${id}`))id++;
  const c:MultiComponent={id:`p${id}`,label:`峰 ${id}`,enabled:true,model:'psd_voigt1',parameters:{
    A:{value:candidate?.A??Math.max(net*width,1e-8),fixed:false},xc:{value:candidate?.xc??points[best].x,fixed:false},
    w:{value:candidate?.w??width,fixed:false},mu:{value:candidate?.mu??.35,fixed:false}}};
  changeMultiModel({...config,components:[c],constraints:[]},c.id,model);
  config.components.push(c);return c;
}
/** 先验证全部模型切换，避免后面的峰有冲突时只改动了前面的峰。 */
export function changeAllMultiModels(config:MultiRequest,model:PeakModel){
  if(!PEAK_MODEL_PARAMETERS[model])throw new Error('未知峰形');
  const next={...config,components:clone(config.components)};
  for(const c of next.components)changeMultiModel(next,c.id,model);
  config.components=next.components;
}
export function changeMultiModel(config:MultiRequest,id:string,model:PeakModel){
  const c=config.components.find(c=>c.id===id);if(!c)throw new Error('峰不存在');
  const names=PEAK_MODEL_PARAMETERS[model];if(!names)throw new Error('未知峰形');
  if(config.constraints.some(link=>[link.source,link.target].some(r=>r.component===id&&!names.includes(r.parameter))))throw new Error('请先解除不适用于新模型的关联');
  const p=c.parameters,width=p.w?.value??p.wG?.value??(p.h_low&&p.h_high?p.h_low.value+p.h_high.value:2.354820045*(p.sigma?.value??1));
  const defaults:Record<PeakParameterName,number>={A:p.A?.value??1,xc:p.xc?.value??0,w:width,wG:width,wL:width,mu:.35,h_low:width/2,h_high:width/2,sigma:width/2.354820045,tau:width/4};
  c.parameters=Object.fromEntries(names.map(n=>[n,p[n]??{value:defaults[n],fixed:false}]));c.model=model;
}
export function removeMultiComponent(config:MultiRequest,id:string){
  if(config.constraints.some(c=>c.source.component===id||c.target.component===id))throw new Error('请先解除该峰的关联');
  config.components=config.components.filter(c=>c.id!==id);
}
export function loadMultiConfiguration(artifact:unknown,x:number[],y:number[],source:XpsSource|null,mode:MultiMode,validate:(c:MultiRequest)=>void=validateMulti):MultiRequest {
  const raw=(artifact as {configuration?:MultiRequest})?.configuration;
  if(!raw)throw new Error("配置结构无效");
  const c=clone(raw);
  if(!c||c.schema_version!==1||c.analysis_mode!==mode||!Array.isArray(c.components)||!Array.isArray(c.constraints)||!c.baseline||!c.solver)throw new Error('配置版本、模式或结构无效');
  if(!source||!c.source||['file_sha256','sheet','x_column','y_column'].some(k=>source[k as keyof XpsSource]!==c.source![k as keyof XpsSource]))throw new Error('配置与当前原文件或谱列不匹配');
  if(JSON.stringify(c.x)!==JSON.stringify(x)||JSON.stringify(c.y)!==JSON.stringify(y))throw new Error('配置与当前数据不匹配');
  validate(c);c.baseline.confirmed=false;return c;
}

export function validateMulti(config:MultiRequest) {
  const nodes=new Map<string,{value:number;lower?:number|null;upper?:number|null;fixed:boolean}>(),bounds=new Map<string,[number,number]>(),links=new Map<string,{source:string;a:number;b:number}>();
  if(!Number.isFinite(config.range_start)||!Number.isFinite(config.range_end)||config.range_start>=config.range_end)throw new Error("拟合区间无效");
  const ids=new Set<string>();
  for(const c of config.components){
    if(ids.has(c.id))throw new Error("峰 ID 重复");ids.add(c.id);if(!c.enabled)continue;
    const expected=PEAK_MODEL_PARAMETERS[c.model];
    if(!expected||Object.keys(c.parameters).length!==expected.length||expected.some(n=>!(n in c.parameters)))throw new Error(`${c.id} 的模型参数不匹配`);
    for(const [name,p] of Object.entries(c.parameters)){
      if(!p||!Number.isFinite(p.value)||(p.lower!=null&&!Number.isFinite(p.lower))||(p.upper!=null&&!Number.isFinite(p.upper)))throw new Error(`${c.id}.${name} 参数必须为有限数值`);
      const minWidth=Math.max((config.range_end-config.range_start)*1e-8,1e-10);
      const physical:Record<string,[number,number]>={A:[0,Infinity],xc:[config.range_start,config.range_end],w:[minWidth,Infinity],wG:[minWidth,Infinity],wL:[minWidth,Infinity],h_low:[minWidth,Infinity],h_high:[minWidth,Infinity],sigma:[minWidth,Infinity],tau:[0,Infinity],mu:[0,1]};
      if(!physical[name])throw new Error("未知参数");
      const key=`${c.id}.${name}`;nodes.set(key,p);bounds.set(key,[Math.max(physical[name][0],p.lower??-Infinity),Math.min(physical[name][1],p.upper??Infinity)]);
    }
  }
  for(const c of config.constraints){
    const t=`${c.target.component}.${c.target.parameter}`,s=`${c.source.component}.${c.source.parameter}`;
    if(!nodes.has(t)||!nodes.has(s))throw new Error("约束引用不存在或停用的峰参数");
    if(t===s)throw new Error("参数不能自引用");
    if(links.has(t))throw new Error("目标参数不能重复绑定");
    if(!Number.isFinite(c.value)||c.target.parameter!==c.source.parameter||!(c.kind==="offset"&&c.target.parameter==="xc"||c.kind==="ratio"&&["A","w","wG","wL","h_low","h_high","sigma"].includes(c.target.parameter)&&c.value>0))throw new Error("约束类型或数值无效");
    links.set(t,{source:s,a:c.kind==="ratio"?c.value:1,b:c.kind==="offset"?c.value:0});
  }
  const expanded=new Map<string,{root:string;a:number;b:number}>();
  function expand(key:string,path=new Set<string>()):{root:string;a:number;b:number}{
    if(path.has(key))throw new Error("峰间约束存在循环依赖");
    if(expanded.has(key))return expanded.get(key)!;
    const link=links.get(key);let value={root:key,a:1,b:0};
    if(link){const parent=expand(link.source,new Set([...path,key]));value={root:parent.root,a:link.a*parent.a,b:link.a*parent.b+link.b};}
    if(!Number.isFinite(value.a)||!Number.isFinite(value.b)||value.a<=0)throw new Error("约束比例链产生无效数值");expanded.set(key,value);return value;
  }
  const roots=new Map<string,{low:number;high:number;fixed?:number}>();
  for(const [key,p] of nodes){
    const e=expand(key),[lo,hi]=bounds.get(key)!;const r=roots.get(e.root)??{low:-Infinity,high:Infinity};
    r.low=Math.max(r.low,(lo-e.b)/e.a);r.high=Math.min(r.high,(hi-e.b)/e.a);
    if(p.fixed){const value=(p.value-e.b)/e.a;if(r.fixed!==undefined&&Math.abs(r.fixed-value)>1e-10*Math.max(1,Math.abs(value)))throw new Error("固定参数与绑定关系冲突");r.fixed=value;}
    roots.set(e.root,r);
  }
  for(const r of roots.values())if(r.low>r.high||(r.fixed!==undefined&&(r.fixed<r.low||r.fixed>r.high)))throw new Error("约束边界无可行交集或固定值越界");
}
