import type {PeakWorkspace,NormalizedAnalysis,FormulaDraft} from './peakRecordTypes';
import {clonePeak,readMappingTemplate} from './peakResultImportState';
export interface PeakAnalysisArchive {format:'peak-analysis';schema_version:1;saved_at:string;workspace:PeakWorkspace}
export function createPeakWorkspace():PeakWorkspace{return {analysis:null,templates:[],formulaDraft:{method:'formula',config:{scope:'row',variables:{area:{field:'area'}},outputs:[{name:'result',expression:'area',unit:'a.u.'}]}},calculations:[],revision:0,note:''};}
export function invalidateCalculations(workspace:PeakWorkspace,reason:string){workspace.revision++;for(const c of workspace.calculations){c.stale=true;c.stale_reason=reason;}}
const fail=(s:string):never=>{throw new Error(`解析档案无效：${s}`);};
function budget(value:any){let nodes=0;const visit=(v:any,depth:number)=>{if(++nodes>1000000||depth>40)fail('超出容量');if(typeof v==='number'&&!Number.isFinite(v))fail('数值必须有限');if(typeof v==='string'&&v.length>100000)fail('文本过长');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('非法键');visit(x,depth+1);}};visit(value,0);}
const plain=(v:unknown):v is Record<string,any>=>Boolean(v&&typeof v==='object'&&!Array.isArray(v));
function validateDraft(d:FormulaDraft){
 if(!d||!['formula','lattice','scherrer','strain','williamson_hall','calibration'].includes(d.method)||!plain(d.config))fail('计算草稿方法或配置');const c=d.config;
 if(c.record_ids!==undefined&&(!Array.isArray(c.record_ids)||c.record_ids.some((id:unknown)=>typeof id!=='string')))fail('草稿峰选择');
 if(d.method==='formula'){
  if(!plain(c.variables)||!Array.isArray(c.outputs)||!c.outputs.length||c.outputs.length>20)fail('公式草稿变量或输出结构');
  for(const b of Object.values(c.variables))if(!plain(b)||b.field!==undefined&&typeof b.field!=='string'||b.metadata!==undefined&&typeof b.metadata!=='string')fail('公式草稿变量绑定');
  for(const o of c.outputs)if(!plain(o)||typeof o.name!=='string'||typeof o.expression!=='string'||typeof o.unit!=='string')fail('公式草稿输出结构');
 }
 for(const key of ['wavelength','d0','measured_d','coefficients'])if(c[key]!=null&&!plain(c[key]))fail(`材料草稿 ${key} 结构`);
 for(const key of ['hkl','reference_hkl'])if(c[key]!=null&&(!Array.isArray(c[key])||c[key].length!==3||c[key].some((v:unknown)=>v!==null&&!['number','string'].includes(typeof v))))fail(`材料草稿 ${key} 结构`);
 if(c.hkl_by_record!=null){if(!plain(c.hkl_by_record))fail('材料草稿逐峰 hkl');for(const v of Object.values(c.hkl_by_record))if(!Array.isArray(v)||v.length!==3)fail('材料草稿逐峰 hkl');}
 if(['scherrer','williamson_hall'].includes(d.method)){
  if(!plain(c.correction)||typeof c.correction.mode!=='string'||typeof c.correction.source!=='string'||typeof c.correction.conditions_match!=='boolean')fail('材料草稿仪器校正结构');
  if(c.correction.instrument_width!=null&&!plain(c.correction.instrument_width))fail('材料草稿仪器宽度');
  if(c.correction.instrument_table!=null&&(!Array.isArray(c.correction.instrument_table)||c.correction.instrument_table.some((r:unknown)=>!plain(r))))fail('材料草稿仪器表');
 }
 if(c.standards!=null&&(!Array.isArray(c.standards)||c.standards.some((r:unknown)=>!plain(r))))fail('材料草稿标样表');
 if(c.integration_range!=null&&(!Array.isArray(c.integration_range)||c.integration_range.length!==2))fail('材料草稿积分范围');
}
export function validateAnalysis(a:NormalizedAnalysis){
 if(!a||a.schema_version!==1||!Array.isArray(a.records)||!Array.isArray(a.spectra)||!Array.isArray(a.issues)||a.records.length>100000)fail('标准峰表结构');
 const ids=new Set<string>();for(const r of a.records){if(typeof r.id!=='string'||!r.id||ids.has(r.id))fail('峰记录 ID 缺失或重复');ids.add(r.id);for(const key of ['sample_id','spectrum_id','peak_id']as const)if(typeof r[key]!=='string')fail('峰身份');
  if(!r.source||typeof r.source.filename!=='string'||r.source.file_sha256!==null&&typeof r.source.file_sha256!=='string'||!r.fields)fail('来源或字段');
  for(const key of ['position','width','height','area']as const){const q=r.fields[key];if(!q||q.value!==null&&(typeof q.value!=='number'||!Number.isFinite(q.value)))fail(`${key} 不是有限值或缺失标记`);if(q.unit!==null&&typeof q.unit!=='string')fail('单位');if(q.standard_error!=null&&(typeof q.standard_error!=='number'||!Number.isFinite(q.standard_error)||q.standard_error<0))fail('标准误');}
 }
 for(const s of a.spectra){if(!s||typeof s.id!=='string'||typeof s.sample_id!=='string'||!s.metrics||Array.isArray(s.metrics)||!Array.isArray(s.warnings))fail('谱级质量结构');for(const q of Object.values(s.metrics))if(!q||q.value!==null&&(typeof q.value!=='number'||!Number.isFinite(q.value)))fail('谱级质量数值');}
 for(const issue of a.issues)if(!issue||typeof issue.code!=='string'||typeof issue.message!=='string'||!['warning','error'].includes(issue.severity))fail('异常记录');
 budget(a);return a;
}
function validateWorkspace(w:PeakWorkspace){
 if(!w||!Array.isArray(w.templates)||!Array.isArray(w.calculations)||!w.formulaDraft||typeof w.formulaDraft.method!=='string'||!w.formulaDraft.config||typeof w.note!=='string'||!Number.isInteger(w.revision))fail('工作区');
 validateDraft(w.formulaDraft);
 if(w.analysis)validateAnalysis(w.analysis);for(const t of w.templates)readMappingTemplate(JSON.stringify(t));
 const ids=new Set<string>();for(const h of w.calculations){if(typeof h.id!=='string'||ids.has(h.id)||typeof h.created_at!=='string'||typeof h.stale!=='boolean'||!h.request||!Array.isArray(h.request.records)||typeof h.request.method!=='string'||!h.request.config||!h.response||!Array.isArray(h.response.results))fail('计算历史');ids.add(h.id);
  validateAnalysis({schema_version:1,records:h.request.records,spectra:[],issues:[]});
  if(typeof h.response.method!=='string'||typeof h.response.method_version!=='string'||typeof h.response.input_hash!=='string')fail('计算结果方法与来源');
  for(const r of h.response.results){if(!r||typeof r.sample_id!=='string'||!Array.isArray(r.record_ids)||r.record_ids.some(id=>typeof id!=='string')||!['valid','apparent','invalid'].includes(r.status)||!r.values||Array.isArray(r.values)||!Array.isArray(r.warnings)||r.warnings.some(s=>typeof s!=='string'))fail('计算结果结构');for(const q of Object.values(r.values))if(!q||typeof q.unit!=='string'||q.value!==null&&(typeof q.value!=='number'||!Number.isFinite(q.value)))fail('计算结果数值');if(r.error&&(typeof r.error.code!=='string'||typeof r.error.message!=='string'))fail('计算结果错误说明');}
 }
 budget(w);
}
function checkArchiveSize(text:string){if(new TextEncoder().encode(text).length>50*1024*1024)fail('超过 50 MiB');}
export function writePeakArchive(workspace:PeakWorkspace):string{validateWorkspace(workspace);const text=JSON.stringify({format:'peak-analysis',schema_version:1,saved_at:new Date().toISOString(),workspace},null,2);checkArchiveSize(text);return text;}
export function readPeakArchive(text:string):PeakAnalysisArchive{
 checkArchiveSize(text);const a=JSON.parse(text);budget(a);
 if(a?.format!=='peak-analysis'||a.schema_version!==1||typeof a.saved_at!=='string')fail('格式或版本');validateWorkspace(a.workspace);return clonePeak(a);
}
