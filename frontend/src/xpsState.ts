import { componentLine, FIGURE_COLORS } from "./figureStyle";
import type { Candidate, ParamName, XpsModel, XpsComponent, XpsParameter, XpsPreview, XpsRequest, XpsResult, XpsSource } from "./xpsTypes";
import { PEAK_MODEL_PARAMETERS } from "./peakModels";

export function requiredConfigVersion(config:XpsRequest):1|2 {
  const oldModels=['gaussian','lorentz','psd_voigt1'], oldParameters=['A','xc','w','mu'];
  return config.components.some(c=>!oldModels.includes(c.model)||Object.keys(c.parameters).some(p=>!oldParameters.includes(p)))
    ||config.constraints.some(c=>!oldParameters.includes(c.target.parameter)||!oldParameters.includes(c.source.parameter))?2:1;
}
export function changeComponentModel(config:XpsRequest,id:string,model:XpsModel) {
  const c=config.components.find(c=>c.id===id);if(!c)throw new Error('峰不存在');
  const names=PEAK_MODEL_PARAMETERS[model] as ParamName[];
  if(!names||String(model)==='psd_voigt2')throw new Error('不支持的 XPS 模型');
  const conflicts=config.constraints.filter(link=>[link.source,link.target].some(r=>r.component===id&&!names.includes(r.parameter)));
  if(conflicts.length)throw new Error(`请先解除不适用于新模型的关联：${conflicts.map(c=>`${c.target.component}.${c.target.parameter} ← ${c.source.component}.${c.source.parameter}`).join('；')}`);
  const p=c.parameters;
  const width=p.w?.value??(p.h_low&&p.h_high?p.h_low.value+p.h_high.value:2.354820045*(p.sigma?.value??1));
  const defaults:Record<ParamName,number>={A:p.A?.value??1,xc:p.xc?.value??0,w:width,mu:.35,h_low:width/2,h_high:width/2,sigma:width/2.354820045,tau:width/2.354820045*.25};
  c.parameters=Object.fromEntries(names.map(name=>[name,p[name]??{value:defaults[name],fixed:false}]));
  c.model=model;config.schema_version=requiredConfigVersion(config);
}
export function shiftConfiguration(config:XpsRequest,delta:number) {
  if(!Number.isFinite(delta))throw new Error('校正位移必须为有限数值');
  config.shift_eV+=delta;config.range_start+=delta;config.range_end+=delta;
  for(const key of ['low_window','high_window'] as const){const w=config.background[key];if(w)config.background[key]=[w[0]+delta,w[1]+delta];}
  for(const c of config.components){const p=c.parameters.xc;if(p){p.value+=delta;if(p.lower!=null)p.lower+=delta;if(p.upper!=null)p.upper+=delta;}}
}

export function createConfig(x:number[], y:number[], source:XpsSource|null):XpsRequest {
  const lo = x.length ? Math.min(...x) : 0, hi = x.length ? Math.max(...x) : 1;
  const span = hi-lo;
  return {schema_version:1,x:[...x],y:[...y],source,range_start:lo,range_end:hi,shift_eV:0,calibration_note:"",
    background:{kind:"line",low_window:[lo,lo+span*.03],high_window:[hi-span*.03,hi],low_level:null,high_level:null,tolerance:1e-7,max_iterations:500,confirmed:false},
    components:[],constraints:[],groups:[],solver:{max_nfev:3000,tolerance:1e-9}};
}
function startingEstimate(config:XpsRequest, preview?:XpsPreview|null) {
  const points=config.x.map((x,i)=>({x:x+config.shift_eV,y:config.y[i]})).filter(p=>p.x>=config.range_start&&p.x<=config.range_end).sort((a,b)=>a.x-b.x);
  if(points.length<3)throw new Error("当前能区至少需要 3 个数据点");
  let net:number[];
  if(config.background.kind==="shirley"){
    if(!preview||preview.x.length!==points.length||preview.x.some((v,i)=>v!==points[i].x))throw new Error("请先预览当前 Shirley 背景再添加峰");
    net=preview.raw_y.map((v,i)=>v-preview.baseline[i]);
  }else{
    const level=(explicit:number|null,window:[number,number]|null)=>{
      if(explicit!==null)return explicit;
      const values=points.filter(p=>window&&p.x>=window[0]&&p.x<=window[1]).map(p=>p.y).sort((a,b)=>a-b);
      if(!values.length)throw new Error("端点窗口没有数据，请重设窗口或输入背景水平");
      const mid=Math.floor(values.length/2);return values.length%2?values[mid]:(values[mid-1]+values[mid])/2;
    };
    const low=config.background.kind==="none"?0:level(config.background.low_level,config.background.low_window);
    const high=config.background.kind==="none"?0:level(config.background.high_level,config.background.high_window);
    net=points.map(p=>p.y-low-(high-low)*(p.x-points[0].x)/(points.at(-1)!.x-points[0].x));
  }
  let index=0;for(let i=1;i<net.length;i++)if(net[i]>net[index])index=i;
  const width=Math.max((config.range_end-config.range_start)/20,.01);
  return {xc:points[index].x,w:width,A:Math.max(net[index],1)*width*1.2};
}
export function addComponent(config:XpsRequest, candidate?:Partial<Candidate>, preview?:XpsPreview|null):XpsComponent {
  let i=1; while(config.components.some(c=>c.id===`p${i}`)) i++;
  const estimate=candidate?.A!==undefined&&candidate.xc!==undefined&&candidate.w!==undefined?candidate:startingEstimate(config,preview);
  const c:XpsComponent={id:`p${i}`,label:`峰 ${i}`,enabled:true,model:"psd_voigt1",parameters:{
    A:{value:candidate?.A??estimate.A!,fixed:false},
    xc:{value:candidate?.xc??estimate.xc!,fixed:false},
    w:{value:candidate?.w??estimate.w!,fixed:false},mu:{value:candidate?.mu??.35,fixed:false}}};
  config.components.push(c); return c;
}
export function makeDoublet(config:XpsRequest, split:number, ratio:number, preview?:XpsPreview|null) {
  if(!Number.isFinite(split)||!Number.isFinite(ratio)||ratio<=0) throw new Error("请填写有限分裂值及正面积比");
  let id=1;while(config.groups.some(g=>g.id===`g${id}`))id++;
  const center=(config.range_start+config.range_end-split)/2;
  const a=addComponent(config,{xc:center},preview), b=addComponent(config,{xc:center+split,A:a.parameters.A!.value*ratio,w:a.parameters.w!.value},preview);
  config.groups.push({id:`g${id}`,label:`双峰组 ${id}`,component_ids:[a.id,b.id]});
  for(const [parameter,kind,value] of [["xc","offset",split],["A","ratio",ratio],["w","ratio",1]] as const)
    config.constraints.push({target:{component:b.id,parameter},source:{component:a.id,parameter},kind,value});
}
export function removeComponent(config:XpsRequest,id:string) {
  if(config.constraints.some(c=>c.target.component===id||c.source.component===id))throw new Error("请先解除该峰的关联，再删除峰");
  config.components=config.components.filter(c=>c.id!==id);
  config.constraints=config.constraints.filter(c=>c.target.component!==id&&c.source.component!==id);
  config.groups=config.groups.map(g=>({...g,component_ids:g.component_ids.filter(c=>c!==id)})).filter(g=>g.component_ids.length);
}
export function validateConstraints(config:XpsRequest) {
  const nodes=new Map<string,XpsParameter>(),bounds=new Map<string,[number,number]>(),links=new Map<string,{source:string;a:number;b:number}>();
  if(!Number.isFinite(config.range_start)||!Number.isFinite(config.range_end)||config.range_start>=config.range_end)throw new Error("拟合区间无效");
  const ids=new Set<string>();
  for(const c of config.components){
    if(ids.has(c.id))throw new Error("峰 ID 重复");ids.add(c.id);if(!c.enabled)continue;
    const expected=PEAK_MODEL_PARAMETERS[c.model];
    if(!expected||Object.keys(c.parameters).length!==expected.length||expected.some(n=>!(n in c.parameters)))throw new Error(`${c.id} 的模型参数不匹配`);
    for(const [name,p] of Object.entries(c.parameters)){
      if(!p||!Number.isFinite(p.value)||(p.lower!=null&&!Number.isFinite(p.lower))||(p.upper!=null&&!Number.isFinite(p.upper)))throw new Error(`${c.id}.${name} 参数必须为有限数值`);
      const minWidth=Math.max((config.range_end-config.range_start)*1e-8,1e-10);
      const physical:Record<string,[number,number]>={A:[0,Infinity],xc:[config.range_start,config.range_end],w:[minWidth,Infinity],h_low:[minWidth,Infinity],h_high:[minWidth,Infinity],sigma:[minWidth,Infinity],tau:[0,Infinity],mu:[0,1]};
      if(!physical[name])throw new Error("未知参数");
      const key=`${c.id}.${name}`;nodes.set(key,p);bounds.set(key,[Math.max(physical[name][0],p.lower??-Infinity),Math.min(physical[name][1],p.upper??Infinity)]);
    }
  }
  for(const c of config.constraints){
    const t=`${c.target.component}.${c.target.parameter}`,s=`${c.source.component}.${c.source.parameter}`;
    if(!nodes.has(t)||!nodes.has(s))throw new Error("约束引用不存在或停用的峰参数");
    if(t===s)throw new Error("参数不能自引用");
    if(links.has(t))throw new Error("目标参数不能重复绑定");
    if(!Number.isFinite(c.value)||c.target.parameter!==c.source.parameter||!(c.kind==="offset"&&c.target.parameter==="xc"||c.kind==="ratio"&&["A","w","h_low","h_high","sigma"].includes(c.target.parameter)&&c.value>0))throw new Error("约束类型或数值无效");
    links.set(t,{source:s,a:c.kind==="ratio"?c.value:1,b:c.kind==="offset"?c.value:0});
  }
  const expanded=new Map<string,{root:string;a:number;b:number}>();
  function expand(key:string,path=new Set<string>()):{root:string;a:number;b:number}{
    if(path.has(key))throw new Error("峰间约束存在循环依赖");
    if(expanded.has(key))return expanded.get(key)!;
    const link=links.get(key);let value={root:key,a:1,b:0};
    if(link){const parent=expand(link.source,new Set([...path,key]));value={root:parent.root,a:link.a*parent.a,b:link.a*parent.b+link.b};}
    expanded.set(key,value);return value;
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
export class RevisionGate {
  revision=0; private sequence:Record<string,number>={};
  invalidate(){this.revision++;}
  start(kind:string){this.sequence[kind]=(this.sequence[kind]??0)+1;return {kind,sequence:this.sequence[kind],revision:this.revision};}
  current(token:{kind:string;sequence:number;revision:number}){return token.revision===this.revision&&token.sequence===this.sequence[token.kind];}
}
export function loadConfiguration(artifact:unknown,x:number[],y:number[],source:XpsSource|null):XpsRequest {
  if(!artifact||typeof artifact!=="object"||Array.isArray(artifact))throw new Error("配置 JSON 结构无效，请选择 XPS 配置或拟合结果文件");
  const data=artifact as {schema_version?:number;request?:XpsRequest;configuration?:XpsRequest};
  // 配置导出使用 request，拟合结果保存同一版本的 configuration；只恢复配置。
  const isExport="request" in data;
  if(!isExport&&!("configuration" in data))throw new Error("配置未找到，请选择 XPS 配置或包含 configuration 的拟合结果 JSON");
  if(isExport||"schema_version" in data){
    if(data.schema_version==null)throw new Error("配置文件缺少 schema_version 版本字段");
    if(data.schema_version!==1&&data.schema_version!==2)throw new Error(`不支持的配置版本：${data.schema_version}，当前支持版本 1、2`);
  }
  const c=isExport?data.request:data.configuration;
  if(!c||typeof c!=="object"||Array.isArray(c))throw new Error("配置结构不完整");
  if(c.schema_version==null)throw new Error("配置缺少 schema_version 版本字段");
  if(c.schema_version!==1&&c.schema_version!==2)throw new Error(`不支持的配置版本：${c.schema_version}，当前支持版本 1、2`);
  if(data.schema_version!=null&&data.schema_version!==c.schema_version)throw new Error('配置内外版本不一致');
  if(!c.source)throw new Error("配置缺少原文件及谱列信息，无法核对原始数据");
  if(!source||["file_sha256","sheet","x_column","y_column"].some(key=>c.source![key as keyof XpsSource]!==source[key as keyof XpsSource]))throw new Error(`配置与当前原文件或谱列不匹配。请导入原文件 ${c.source.filename}，选择工作表 ${c.source.sheet}、X 列 ${c.source.x_column}、Y 列 ${c.source.y_column}`);
  if(!Array.isArray(c.x)||!Array.isArray(c.y)||c.x.length!==x.length||c.y.length!==y.length||c.x.some((v,i)=>v!==x[i])||c.y.some((v,i)=>v!==y[i]))throw new Error("配置中的原始数据与当前谱不匹配");
  if(!Array.isArray(c.components)||!Array.isArray(c.constraints)||!Array.isArray(c.groups)||!c.background||!c.solver)throw new Error("配置结构不完整");
  if(c.schema_version===1&&requiredConfigVersion(c)===2)throw new Error('非对称模型或新增参数需要配置版本 2');
  validateConstraints(c);
  return JSON.parse(JSON.stringify(c)) as XpsRequest;
}
export function chartTraces(x:number[],y:number[],preview:XpsPreview|null,result:XpsResult|null) {
  const traces:Array<{x:number[];y:number[];name:string;type:string;mode:string;line?:object;marker?:object}>=[{x,y,name:"原始谱",type:"scatter",mode:"markers",marker:{size:3.5,color:FIGURE_COLORS.observation,opacity:0.7}}];
  if(preview)traces.push({x:preview.x,y:preview.baseline,name:"固定背景",type:"scatter",mode:"lines",line:{color:FIGURE_COLORS.background,dash:"dash",width:1.5}});
  if(result){
    traces.push({x:result.x,y:result.total_y,name:"总拟合",type:"scatter",mode:"lines",line:{color:FIGURE_COLORS.fit,width:2.2}});
    result.components.forEach(c=>traces.push({x:result.x,y:c.y,name:`${c.label}（净峰）`,type:"scatter",mode:"lines",line:componentLine(c.id)}));
  }
  return traces;
}
