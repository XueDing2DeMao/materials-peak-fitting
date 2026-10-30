<script setup lang="ts">
import {computed,ref} from 'vue';
import {readSession,writeSession,sessionRequests,attachSessionData,SESSION_MAX_BYTES,type SessionArchive,type SingleSession,type BatchSession} from '../sessionArchive';
import {saveFile} from '../resultExport';
import {confirmDiscard} from '../useWorkProtection';
import {uploadDataset,previewDataset} from '../api';
import {isMulti} from '../fitAdapter';
import type {ReportEntry} from '../analysisReport';
import AnalysisReportActions from './AnalysisReportActions.vue';
import CompactFitResults from './CompactFitResults.vue';
import PeakResultTable from './PeakResultTable.vue';
import SamplingDiagnostics from './SamplingDiagnostics.vue';
import {snapshotPeaks,snapshotUnit} from '../analysisSnapshot';
import BatchResultChart from './BatchResultChart.vue';
const props=defineProps<{capture:()=>SingleSession|BatchSession;restore:(a:SessionArchive)=>Promise<void>;busy:boolean;scopeLabel?:string}>();
const fileInput=ref<HTMLInputElement|null>(null),sourceInput=ref<HTMLInputElement|null>(null),working=ref(false),error=ref(''),message=ref(''),candidate=ref<SessionArchive|null>(null),selected=ref(0);
const readOnlyEntries=computed<ReportEntry[]>(()=>{
  const w=candidate.value?.workspace;if(!w)return [];
  return w.kind==='single'?[{label:w.configuration.source?.filename??'单谱',snapshot:w.result,status:'只读预览'}]:w.rows.map(r=>({label:r.label,status:r.status,snapshot:r.result?{engine:isMulti(r.result.configuration)?'multi':'xps',configuration:r.result.configuration,result:r.result,stale:r.status==='pending',accepted:r.attempts.some(a=>a.id===r.accepted_attempt_id&&a.manually_accepted)}:null}));
});
const selectedSnapshot=computed(()=>readOnlyEntries.value[selected.value]?.snapshot);
function save(){error.value='';message.value='';try{saveFile('spectral-fit-session-v1.json',writeSession(props.capture()),'application/json');message.value='已生成分析进度下载文件。请保管下载的 JSON；刷新或关闭页面不会自动保存。';}catch(e){error.value=String(e);}}
async function commit(a:SessionArchive){
  if(props.busy)throw new Error('当前计算或导入尚未结束，请完成或暂停后再恢复。');
  if(!await confirmDiscard(true,`载入将替换当前${a.workspace.kind==='batch'?'目标分析类型的批次':'通用、XRD 和 XPS 单谱'}工作区。结果与历史按文件恢复，不自动求解；继续前需重新复核背景。`))return;
  if(props.busy)throw new Error('当前工作已开始计算，请稍后再恢复。');
  await props.restore(a);candidate.value=null;message.value='会话已恢复；载入时未发起拟合。请在继续计算前重新预览并复核背景。';
}
async function load(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||props.busy||working.value)return;
  working.value=true;error.value='';message.value='';
  try{if(file.size>SESSION_MAX_BYTES)throw new Error('会话文件超过 100 MiB');const a=readSession(await file.text());
    if(a.read_only){candidate.value=a;selected.value=0;message.value='原谱快照不完整，以下仅为只读预览；当前工作区保持原样。请匹配原文件后再恢复计算。';}
    else await commit(a);
  }catch(e){error.value=`载入失败，当前工作未替换：${String(e)}`;}finally{input.value='';working.value=false;}
}
async function attach(event:Event){
  const input=event.target as HTMLInputElement,files=Array.from(input.files??[]);if(!candidate.value||!files.length)return;
  working.value=true;error.value='';
  try{let next=candidate.value;
    for(const file of files){const uploaded=await uploadDataset(file);
      const sources=[...new Map(sessionRequests(next.workspace).filter(c=>!c.x.length&&c.source?.file_sha256===uploaded.file_sha256).map(c=>[JSON.stringify(c.source),c.source!])).values()];
      if(!sources.length)throw new Error(`${file.name} 的哈希不匹配缺失原谱`);
      for(const source of sources){const data=await previewDataset(uploaded.dataset_id,source.sheet,source.x_column,source.y_column);next=attachSessionData(next,source,data.x,data.y);}
    }
    candidate.value=next;
    if(next.read_only)message.value='已匹配所选文件；仍有缺失原谱，请继续选择其余原文件。';
    else await commit(next);
  }catch(e){error.value=`原谱匹配失败，当前工作未替换：${String(e)}`;}finally{working.value=false;input.value='';}
}
</script>
<template><details class="panel session-actions"><summary>分析进度 · 保存与恢复</summary>
  <p class="hint session-save-scope">保存范围：{{scopeLabel??'当前单谱或批次分析'}}，包含原谱、拟合设置与已保存的结果。其他工作区不包含在此文件中。</p>
  <p class="hint">手动保存当前单谱或批次的原谱、配置、结果、尝试与实验记录。不会自动保存，不含未纳入批次的草稿和方案比较临时编辑。最多 100 MiB、100 条谱线、200,000 个原谱点。</p>
  <div class="xps-actions"><button :disabled="busy||working" @click="save">保存分析进度</button><button :disabled="busy||working" @click="fileInput?.click()">恢复分析进度</button></div>
  <input ref="fileInput" type="file" accept=".json,application/json" hidden data-test="session-file" @change="load" />
  <p v-if="working" role="status">正在校验会话或匹配原文件…</p><p v-if="message" role="status">{{message}}</p><p v-if="error" role="alert" class="error">{{error}}</p>
  <section v-if="candidate" aria-label="缺失原谱会话只读预览">
    <h3>只读预览 · 当前工作区尚未替换</h3><button :disabled="working||busy" @click="sourceInput?.click()">匹配缺失的原文件</button> <button :disabled="working" @click="candidate=null">关闭只读预览</button>
    <input ref="sourceInput" type="file" multiple hidden @change="attach" />
    <label>查看结果<select v-model.number="selected"><option v-for="(entry,i) in readOnlyEntries" :key="i" :value="i">{{entry.label}} · {{entry.status}}</option></select></label>
    <template v-if="selectedSnapshot"><p v-if="selectedSnapshot.stale" role="status">此结果属于旧配置，已过期。</p>
      <template v-if="selectedSnapshot.engine==='single'"><PeakResultTable :peaks="snapshotPeaks(selectedSnapshot)" :unit="snapshotUnit(selectedSnapshot)" /><SamplingDiagnostics :peaks="snapshotPeaks(selectedSnapshot)" :x="selectedSnapshot.result.x" :unit="snapshotUnit(selectedSnapshot)" :xrd="snapshotUnit(selectedSnapshot)==='°'" /></template>
      <template v-else><BatchResultChart :request="selectedSnapshot.configuration" :preview="selectedSnapshot.result as any" :result="selectedSnapshot.result as any" selected-peak="" /><CompactFitResults :prefix="selectedSnapshot.engine==='xps'?'xps':'multi'" hide-actions :result="selectedSnapshot.result as any" :stale="selectedSnapshot.stale" :busy="false" :unit="isMulti(selectedSnapshot.configuration)?'X 单位':'eV'" /></template>
    </template><p v-else>该谱没有拟合结果。</p>
    <AnalysisReportActions :entries="readOnlyEntries" :disabled="working" />
  </section>
</details></template>
<style scoped>.session-actions{margin:12px 0;min-width:0}.session-actions button{height:auto;min-height:40px;white-space:normal}.session-actions p{overflow-wrap:anywhere}</style>
