import type { BatchRunner } from './batchRunner';
import type { XpsSource } from './xpsTypes';
import { emptyMetadata,type ExperimentMetadata,type MetadataByTask } from './batchTrend';

// 用户已确认的 v2 合同：仅添加实验记录，不提供会话恢复。
type Snapshot=Pick<BatchRunner,'id'|'status'|'sequential'|'rows'>;
function metadata(value:unknown):ExperimentMetadata{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('实验记录必须是对象');
  const v=value as Record<string,unknown>,result=emptyMetadata();
  for(const key of ['sample_id','condition_name','condition_unit','replicate_id'] as const){
    const text=v[key]??'';if(typeof text!=='string'||text.length>200)throw new Error('实验记录文本须为 200 字以内字符串');result[key]=text.trim();
  }
  const number=v.condition_value??null;
  if(number!==null&&(typeof number!=='number'||!Number.isFinite(number)))throw new Error('条件值必须是有限数值或 null');
  result.condition_value=number as number|null;return result;
}
export function experimentArchive(run:Snapshot,records:MetadataByTask){
  const entries=run.rows.map(r=>[r.id,metadata(records[r.id]??emptyMetadata())]);
  return {template_version:2,batch_id:run.id,status:run.status,sequential:run.sequential,rows:run.rows,experiment_metadata:Object.fromEntries(entries) as MetadataByTask};
}
function sourceKey(source:XpsSource|null|undefined){return source?JSON.stringify([source.file_sha256,source.sheet,source.x_column,source.y_column]):null;}
export function readExperimentMetadata(artifact:unknown,targets:{id:string;source:XpsSource|null}[]):MetadataByTask{
  if(!artifact||typeof artifact!=='object')throw new Error('请选择批次追溯 JSON');
  const a=artifact as Record<string,any>;
  if(![1,2].includes(a.template_version))throw new Error('不支持的批次版本，仅支持 1 / 2');
  if(!Array.isArray(a.rows)||a.rows.length>100)throw new Error('批次谱线列表无效或超过 100 条');
  if(a.template_version===1)return {};
  if(!a.experiment_metadata||typeof a.experiment_metadata!=='object'||Array.isArray(a.experiment_metadata))throw new Error('缺少实验记录映射');
  const result:MetadataByTask={};
  for(const [id,value] of Object.entries(a.experiment_metadata)){
    const archived=a.rows.filter((r:any)=>r?.id===id);
    if(archived.length!==1)throw new Error('实验记录任务 ID 不存在或重复');
    const key=sourceKey(archived[0].request?.source);
    const exact=targets.filter(t=>t.id===id&&key!==null&&sourceKey(t.source)===key);
    const matches=exact.length?exact:targets.filter(t=>key!==null&&sourceKey(t.source)===key);
    if(matches.length>1)throw new Error('同一来源重复，无法唯一匹配实验记录；请分别处理');
    if(!matches.length)throw new Error('原文件哈希、工作表或 X/Y 列无法匹配当前谱线');
    if(result[matches[0].id])throw new Error('重复来源无法唯一映射，请分别处理');
    result[matches[0].id]=metadata(value);
  }
  return result;
}
