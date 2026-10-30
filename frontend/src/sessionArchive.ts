/** 用户确认的独立本地会话版本 1；不复用追溯文件或后端数据集缓存。 */
import type {BatchRequest,BatchRow} from './batchTypes';
import type {AnalysisSnapshot} from './analysisSnapshot';
import type {SingleSolverSettings} from './singleFitAdapter';
import {readSingleSettings} from './singleFitAdapter';
import {PEAK_MODEL_PARAMETERS} from './peakModels';
import type {DatasetAudit} from './datasetAudit';
import type {MetadataByTask} from './batchTrend';
import {experimentArchive,readExperimentMetadata} from './batchExperimentArchive';
import {isMulti,topology,inheritanceWarnings} from './fitAdapter';
import {clone,validateMulti} from './multipeakState';
import {validateConstraints,requiredConfigVersion} from './xpsState';

export const SESSION_MAX_BYTES=100*1024*1024;
export interface SingleSession {
  kind:'single';configuration:BatchRequest;result:AnalysisSnapshot|null;single_settings?:SingleSolverSettings;audit?:DatasetAudit|null;
}
export interface BatchSession {
  kind:'batch';template:BatchRequest;batch_id:string;status:string;sequential:boolean;rows:BatchRow[];metadata:MetadataByTask;audits:Record<string,DatasetAudit|null>;
}
export interface SessionArchive {format:'spectral-fit-session';session_version:1;saved_at:string;workspace:SingleSession|BatchSession;read_only?:boolean}
const fail=(message:string):never=>{throw new Error(`会话文件无效：${message}`);};
function object(v:any,label:string){if(!v||typeof v!=='object'||Array.isArray(v))fail(label);}
function string(v:any,label:string){if(typeof v!=='string')fail(label);}
function bool(v:any,label:string){if(typeof v!=='boolean')fail(label);}
function number(v:any,label:string){if(typeof v!=='number'||!Number.isFinite(v))fail(label);}
function array(v:any,label:string,max=200000){if(!Array.isArray(v)||v.length>max)fail(label);}
function vector(v:any,label:string){array(v,label);for(const n of v)number(n,label);}
function budget(value:unknown){let count=0;const walk=(v:any,depth:number)=>{if(++count>4000000||depth>32)fail('内容超过安全容量');if(typeof v==='number')number(v,'非有限数值');if(typeof v==='string'&&v.length>20000)fail('文本过长');if(v&&typeof v==='object')for(const [k,x] of Object.entries(v)){if(['__proto__','constructor','prototype'].includes(k))fail('非法键');walk(x,depth+1);}};walk(value,0);}
function source(s:any){if(s===null)return;object(s,'缺少来源');for(const key of ['filename','file_sha256','sheet','x_column','y_column'])string(s[key],`来源 ${key}`);if(!/^[a-f0-9]{64}$/i.test(s.file_sha256)||s.x_column===s.y_column)fail('来源哈希或列身份');}
function request(c:any){
  object(c,'配置');vector(c.x,'X 数据');vector(c.y,'Y 数据');if(c.x.length!==c.y.length)fail('X/Y 长度不一致');
  if(![1,2].includes(c.schema_version))fail('配置版本');source(c.source);number(c.range_start,'区间');number(c.range_end,'区间');if(c.range_start>=c.range_end)fail('区间上下限');
  array(c.components,'峰列表',40);array(c.constraints,'约束列表',160);object(c.solver,'求解设置');number(c.solver.max_nfev,'求值上限');number(c.solver.tolerance,'容差');
  if(!Number.isInteger(c.solver.max_nfev)||c.solver.max_nfev<1||c.solver.max_nfev>20000||c.solver.tolerance<1e-14||c.solver.tolerance>1e-3)fail('求解设置越界');
  const ids=new Set<string>();for(const p of c.components){object(p,'峰');string(p.id,'峰 ID');string(p.label,'峰标签');bool(p.enabled,'启用状态');if(ids.has(p.id))fail('峰 ID 重复');ids.add(p.id);const names=(PEAK_MODEL_PARAMETERS as any)[p.model] as string[]|undefined;if(!names)fail('未知峰模型');object(p.parameters,'峰参数');for(const name of names!){const v=p.parameters[name];object(v,'缺少峰参数');number(v.value,'参数值');bool(v.fixed,'参数固定状态');for(const key of ['lower','upper'])if(v[key]!=null)number(v[key],'参数边界');}}
  for(const l of c.constraints){object(l,'约束');for(const key of ['source','target']){object(l[key],'约束端点');if(!ids.has(l[key].component)||!c.components.find((p:any)=>p.id===l[key].component)?.parameters[l[key].parameter])fail('约束引用');}if(!['offset','ratio'].includes(l.kind))fail('约束类型');number(l.value,'约束数值');}
  if('analysis_mode' in c){if(!['general','xrd'].includes(c.analysis_mode))fail('分析类型');object(c.baseline,'基线');if(!['none','constant','line','polynomial','spline','bspline'].includes(c.baseline.kind))fail('基线类型');array(c.baseline.anchors,'锚点',1000);for(const a of c.baseline.anchors){number(a.x,'锚点 X');number(a.y,'锚点 Y');}number(c.baseline.degree,'基线阶数');number(c.baseline.smoothing,'平滑');bool(c.baseline.confirmed,'背景复核');}
  else{number(c.shift_eV,'校准');string(c.calibration_note,'校准依据');object(c.background,'XPS 背景');if(!['none','line','shirley'].includes(c.background.kind))fail('XPS 背景类型');bool(c.background.confirmed,'背景复核');number(c.background.tolerance,'背景容差');number(c.background.max_iterations,'背景迭代');for(const key of ['low_window','high_window'])if(c.background[key]!==null){vector(c.background[key],'背景窗口');if(c.background[key].length!==2)fail('背景窗口');}array(c.groups,'峰组',40);for(const g of c.groups){string(g.id,'峰组 ID');string(g.label,'峰组标签');array(g.component_ids,'峰组成员',40);if(g.component_ids.some((id:any)=>!ids.has(id)))fail('峰组引用');}}
  for(const p of c.components){
    if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(p.id))fail('峰 ID 格式');
    if(Object.keys(p.parameters).length!==(PEAK_MODEL_PARAMETERS as any)[p.model].length)fail('峰模型参数不匹配');
  }
  if(isMulti(c)){
    if(c.schema_version!==1||!Number.isInteger(c.baseline.degree)||c.baseline.degree<1||c.baseline.degree>8||c.baseline.smoothing<0)fail('基线或配置版本无效');
    validateMulti(c);
  }else{
    if(c.components.some((p:any)=>p.model==='psd_voigt2')||c.schema_version<requiredConfigVersion(c))fail('XPS 模型或配置版本无效');
    const b=c.background;if(b.tolerance<=0||b.tolerance>0.01||!Number.isInteger(b.max_iterations)||b.max_iterations<1||b.max_iterations>10000)fail('背景求解设置越界');
    for(const key of ['low_level','high_level'])if(b[key]!=null)number(b[key],'背景端点');
    const members=c.groups.flatMap((g:any)=>g.component_ids);
    if(new Set(c.groups.map((g:any)=>g.id)).size!==c.groups.length||new Set(members).size!==members.length)fail('峰组或成员重复');
    validateConstraints(c);
  }
}
const sameData=(a:BatchRequest,b:BatchRequest)=>JSON.stringify([a.source,a.x,a.y])===JSON.stringify([b.source,b.x,b.y]);
function geometry(g:any){if(g===undefined)return;object(g,'峰性质');for(const key of ['peak_position','peak_height','fwhm','hwhm_low','hwhm_high','halfmax_low','halfmax_high','area_total','area_in_range','area_fraction_in_range'])if(g[key]!==null)number(g[key],`峰性质 ${key}`);object(g.reasons,'峰性质原因');array(g.warnings,'峰性质警告');g.warnings.forEach((v:any)=>string(v,'峰性质警告'));for(const k of ['area_method','width_method','uncertainty_note'])string(g[k],k);}
function parameters(p:any){object(p,'结果参数');for(const v of Object.values(p) as any[]){object(v,'结果参数项');number(v.value,'结果参数值');bool(v.fixed,'结果固定状态');if(v.uncertainty_reason!=null)string(v.uncertainty_reason,'标准误说明');if(v.standard_error!==null)number(v.standard_error,'标准误');if(v.confidence_interval!=null){vector(v.confidence_interval,'置信区间');if(v.confidence_interval.length!==2)fail('置信区间');}}}
function result(r:any,engine:string,c:BatchRequest){
  object(r,'结果');for(const key of ['x','raw_y','baseline','total_y'])vector(r[key],`结果 ${key}`);const n=r.x.length;if(!n||['raw_y','baseline','total_y'].some(k=>r[k].length!==n))fail('结果数组长度');bool(r.converged,'收敛状态');string(r.message,'求解信息');object(r.statistics,'统计量');number(r.statistics.rmse,'结果 RMSE');for(const value of Object.values(r.statistics))if(value!==null&&typeof value!=='boolean')number(value,'统计量');
  if(engine==='single'){const enabled=c.components.filter(p=>p.enabled);if(enabled.length!==1||enabled[0].model!==r.model)fail('单峰结果模型不一致');parameters(r.parameters);vector(r.peak_y,'净峰');vector(r.residual,'残差');vector(r.net_y,'净信号');if([r.peak_y,r.residual,r.net_y].some(a=>a.length!==n))fail('单峰结果长度');geometry(r.peak_geometry);}
  else{request(r.configuration);if(!sameData(c,r.configuration)||topology(c)!==topology(r.configuration))fail('结果与请求来源或峰身份不一致');array(r.components,'结果峰',40);vector(r.residuals,'残差');if(r.residuals.length!==n)fail('残差长度');array(r.groups,'结果峰组',40);for(const g of r.groups){string(g.id,'峰组 ID');string(g.label,'峰组标签');array(g.component_ids,'峰组成员',40);}
    const ids=new Set();for(const p of r.components){if(!c.components.some(v=>v.id===p.id&&v.model===p.model)||ids.has(p.id))fail('结果峰身份');ids.add(p.id);string(p.label,'结果峰标签');parameters(p.parameters);vector(p.y,'峰曲线');if(p.y.length!==n)fail('峰曲线长度');geometry(p.peak_geometry);}
    object(r.diagnostics,'诊断');for(const k of ['identifiable','uncertainty_available'])bool(r.diagnostics[k],'诊断标记');for(const k of ['warnings','bound_parameters']){array(r.diagnostics[k],'诊断列表');r.diagnostics[k].forEach((v:any)=>string(v,'诊断文字'));}array(r.diagnostics.strong_correlations,'相关诊断');for(const p of r.diagnostics.strong_correlations){string(p.a,'相关参数');string(p.b,'相关参数');number(p.correlation,'相关值');}
    if(engine==='xps'){vector(r.x_raw,'原始能量');if(r.x_raw.length!==n)fail('原始能量长度');object(r.background,'结果背景');string(r.background.kind,'结果背景类型');bool(r.background.converged,'背景收敛');number(r.background.iterations,'背景迭代数');}
  }
  // 缺少完整原谱时只允许查看；存在原谱时核对结果中的实际观测。
  if(c.x.length){const shift=isMulti(c)?0:c.shift_eV;const pairs=new Map(c.x.map((v,i)=>[v+shift,c.y[i]]));for(let i=0;i<n;i++){const observed=pairs.get(r.x[i]);if(observed===undefined||Math.abs(observed-r.raw_y[i])>1e-10*Math.max(1,Math.abs(observed)))fail('结果观测与原始快照不匹配');}}
}
function snapshot(s:any){object(s,'结果快照');if(!['single','multi','xps'].includes(s.engine))fail('求解路径');request(s.configuration);if((s.engine==='xps')===isMulti(s.configuration))fail('求解路径与配置不一致');bool(s.stale,'结果失效标记');if(s.engine==='single')readSingleSettings(s.singleSettings);result(s.result,s.engine,s.configuration);if(s.engine!=='single'&&JSON.stringify(s.configuration)!==JSON.stringify(s.result.configuration))fail('保存结果的配置快照不一致');}
function audit(a:any){if(a==null)return;object(a,'数据审计');if(a.version!==1||a.row_basis!=='parsed_sheet_after_empty_rows_removed')fail('审计版本');for(const k of ['sheet_rows','valid_pairs','excluded_pairs','duplicate_x_count'])if(!Number.isInteger(a[k])||a[k]<0)fail('审计计数');if(a.sheet_rows!==a.valid_pairs+a.excluded_pairs)fail('审计计数不平衡');vector(a.source_rows,'审计行号');if(a.source_rows.length!==a.valid_pairs)fail('审计点数');array(a.excluded_rows,'审计明细',200);for(const row of a.excluded_rows){number(row.parsed_row,'解析行号');array(row.reasons,'排除原因',6);row.reasons.forEach((v:any)=>string(v,'排除原因'));}object(a.exclusion_reasons,'排除计数');for(const n of Object.values(a.exclusion_reasons))number(n,'排除计数');bool(a.sorting_changed,'排序标记');bool(a.excluded_rows_truncated,'截断标记');}

export function readSession(text:string):SessionArchive{
  if(new TextEncoder().encode(text).byteLength>SESSION_MAX_BYTES)fail('文件超过 100 MiB');
  const a=JSON.parse(text);budget(a);object(a,'文件根对象');if(a.format!=='spectral-fit-session'||a.session_version!==1)fail('不支持的会话格式或版本；追溯 JSON 不是会话');string(a.saved_at,'保存时间');const w=a.workspace;object(w,'工作区');
  let points=0,readOnly=false;
  if(w.kind==='single'){
    request(w.configuration);points=w.configuration.x.length;readOnly=!points;readSingleSettings(w.single_settings);audit(w.audit);
    if(w.result){snapshot(w.result);if(!sameData(w.configuration,w.result.configuration))fail('当前配置与结果数据身份不一致');}
    if(readOnly&&!w.result)fail('缺少原谱和结果，请重新选择原文件');
  }else if(w.kind==='batch'){
    request(w.template);array(w.rows,'批次任务',100);if(!w.rows.length)fail('批次无任务');string(w.batch_id,'批次 ID');bool(w.sequential,'批量策略');if(!['ready','running','pausing','paused','stopping','stopped','done'].includes(w.status))fail('批次状态');object(w.audits,'批次审计');Object.values(w.audits).forEach(audit);
    const rowIds=new Set(),attemptIds=new Set();
    const priorAttempts=new Map<string,{row:string;attempt:any}>();
    for(const r of w.rows){string(r.id,'任务 ID');if(rowIds.has(r.id))fail('任务 ID 重复');rowIds.add(r.id);string(r.label,'任务标签');request(r.request);points+=r.request.x.length;readOnly ||= !r.request.x.length;if(topology(r.request)!==topology(w.template))fail('批次峰结构不一致');if(!['pending','running','success','review','failed','skipped'].includes(r.status))fail('任务状态');array(r.attempts,'尝试记录',100);
      for(const at of r.attempts){string(at.id,'尝试 ID');if(attemptIds.has(at.id))fail('尝试 ID 重复');attemptIds.add(at.id);request(at.request);if(!sameData(r.request,at.request))fail('尝试来源不匹配');for(const k of ['manually_accepted','invalidated'])bool(at[k],'尝试标记');string(at.error,'尝试错误');array(at.warnings,'尝试警告');at.warnings.forEach((v:any)=>string(v,'尝试警告'));if(!['template','previous_result','continuation'].includes(at.initialization_source))fail('初值来源');if(at.result)result(at.result,isMulti(at.request)?'multi':'xps',at.request);}
      if(r.result)result(r.result,isMulti(r.request)?'multi':'xps',r.request);
      if(r.status==='success'){const accepted=r.attempts.find((v:any)=>v.id===r.accepted_attempt_id);if(!accepted||accepted!==r.attempts.filter((v:any)=>!v.invalidated).at(-1)||accepted.invalidated||!accepted.result?.converged||JSON.stringify(r.result)!==JSON.stringify(accepted.result))fail('获准结果记录不一致');if(inheritanceWarnings(accepted.result,accepted.request).length&&!accepted.manually_accepted)fail('警告结果缺少人工接受');}
      for(const at of r.attempts){
        if(at.parent_attempt_id!=null){const parent=priorAttempts.get(at.parent_attempt_id);if(!parent||parent!.row!==at.parent_task_id)fail('继承引用不存在或指向后续尝试');
          if(at.initialization_source==='template'||at.initialization_source==='continuation'&&parent!.row!==r.id||at.initialization_source==='previous_result'&&parent!.row===r.id)fail('继承来源类型不匹配');
          if(!at.invalidated&&(!parent!.attempt.result||parent!.attempt.invalidated))fail('继承了无效结果');
          if(!at.invalidated&&at.initialization_source==='previous_result'){const parentRow=w.rows.find((row:any)=>row.id===parent!.row);if(parentRow?.status!=='success'||parentRow.accepted_attempt_id!==parent!.attempt.id)fail('继承来源未经接受');}
        }else if(at.parent_task_id!=null||at.initialization_source!=='template')fail('继承引用缺失');
        priorAttempts.set(at.id,{row:r.id,attempt:at});
      }
    }
    readExperimentMetadata(experimentArchive({id:w.batch_id,status:w.status,sequential:w.sequential,rows:w.rows},w.metadata),w.rows.map((r:any)=>({id:r.id,source:r.request.source})));
    normalizedBatchRows(w.rows);
  }else fail('工作区类型');
  if(points>200000)fail('实际原谱超过 200,000 点');a.read_only=readOnly;return a;
}

export function sessionRequests(w:SingleSession|BatchSession):BatchRequest[]{
  const requests=w.kind==='single'?[w.configuration,...(w.result?[w.result.configuration,...('configuration' in w.result.result?[w.result.result.configuration]:[])]:[])]:
    [w.template,...w.rows.flatMap(r=>[r.request,...(r.result?[r.result.configuration]:[]),...r.attempts.flatMap(a=>[a.request,...(a.result?[a.result.configuration]:[])])])];
  return requests;
}

/** 在副本上补齐匹配源；完整校验通过后调用者才可替换工作区。 */
export function attachSessionData(archive:SessionArchive,source:NonNullable<BatchRequest['source']>,x:number[],y:number[]):SessionArchive{
  const copy=clone(archive);let matches=0;
  for(const c of sessionRequests(copy.workspace)){
    if(!c.x.length&&c.source&&['file_sha256','sheet','x_column','y_column'].every(k=>(c.source as any)[k]===(source as any)[k])){c.x=[...x];c.y=[...y];matches++;}
  }
  if(!matches)throw new Error('原文件哈希、工作表或谱列与缺失数据不匹配');
  return readSession(JSON.stringify(copy));
}
export function writeSession(workspace:SingleSession|BatchSession):string{
  const archive:SessionArchive={format:'spectral-fit-session',session_version:1,saved_at:new Date().toISOString(),workspace:clone(workspace)};
  const text=JSON.stringify(archive);readSession(text);return text;
}
export function normalizedBatchRows(rows:BatchRow[]):BatchRow[]{
  const copy=clone(rows);let unsettled=false;
  for(const r of copy){
    if(r.status==='running'){r.status='pending';r.result=null;r.accepted_attempt_id=null;for(const a of r.attempts)if(!a.result){a.invalidated=true;a.error=a.error||'保存时请求未完成；恢复后需重新执行';}}
    if(unsettled&&['success','review','failed','skipped'].includes(r.status))fail('未完成任务之后存在已终结任务');
    if(r.status==='pending')unsettled=true;
    if(r.result){const at=r.attempts.filter(a=>!a.invalidated&&a.result).at(-1);if(at&&JSON.stringify(at.result)===JSON.stringify(r.result))r.result=at.result;}
  }
  return copy;
}
