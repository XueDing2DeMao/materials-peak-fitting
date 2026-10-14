<script setup lang="ts">
import { computed, ref, nextTick } from 'vue';
import SessionActions from './components/SessionActions.vue';
import type {SessionArchive,SingleSession,BatchSession} from './sessionArchive';
import {sessionDataset} from './sessionDataset';
import { useWorkProtection, confirmDiscard } from './useWorkProtection';
import { previewDataset, uploadDataset } from './api';
import DatasetSummary from './components/DatasetSummary.vue';
import DatasetAuditSummary from './components/DatasetAuditSummary.vue';
import type {DatasetAudit} from './datasetAudit';
import XpsWorkbench from './components/XpsWorkbench.vue';
import BatchWorkbench from './components/BatchWorkbench.vue';
import MultiPeakWorkbench from './components/MultiPeakWorkbench.vue';
import type { BatchRequest } from './batchTypes';
import { isMulti } from './fitAdapter';
import type { XpsSource } from './xpsTypes';
import type { DatasetInfo } from './types';
const dataset=ref<DatasetInfo|null>(null),x=ref<number[]>([]),y=ref<number[]>([]);
const appliedDataset=ref<DatasetInfo|null>(null);
const dataAudit=ref<DatasetAudit|null>(null);
const workspaceEpoch=ref(0);
interface SessionWorkbench {sessionState:()=>SingleSession|BatchSession;restoreSession:(w:any)=>void;isBusy:()=>boolean}
const singleRefs=ref<Record<string,SessionWorkbench|null>>({}),batchRefs=ref<Record<string,SessionWorkbench|null>>({});
const bindSingle=(key:string)=>(el:unknown)=>{if(el)singleRefs.value[key]=el as SessionWorkbench;};
const sessionBusy=computed(()=>loading.value||previewLoading.value||batchBusy.value||Object.values(singleRefs.value).some(w=>w?.isBusy?.()));
const analysisModes=['single','xrd','xps'] as const;
const mode=ref<typeof analysisModes[number]>('single');
const processing=ref<'single'|'batch'>('single');
const workflowDescriptions={single:'原始坐标与单位 · 手动选峰 · 支持单峰与多峰',xrd:'X 列须为 2θ（°）；切换类型不会转换数据或单位。',xps:'X 列：结合能（eV）· 支持能量校准与峰间约束'};
const batchTemplates=ref<Record<typeof analysisModes[number],BatchRequest|null>>({single:null,xrd:null,xps:null});
const batchActivity=ref({single:false,xrd:false,xps:false});
const singleWork=ref<Record<string,boolean>>({single:false,xrd:false,xps:false});
useWorkProtection(()=>x.value.length>0||batchBusy.value||Object.values(singleWork.value).some(Boolean));
const batchBusy=computed(()=>Object.values(batchActivity.value).some(Boolean));
function useBatchTemplate(value:BatchRequest){
  if(batchBusy.value)return;
  const target=isMulti(value)?value.analysis_mode==='xrd'?'xrd':'single':'xps';
  batchTemplates.value[target]=value;mode.value=target;processing.value='batch';
}
const selectionIdentity=ref<{sheet:string;xColumn:string;yColumn:string}|null>(null);
let selectionVersion=0;
const xpsSource=computed<XpsSource|null>(()=>appliedDataset.value?.file_sha256&&selectionIdentity.value?{
  filename:appliedDataset.value.filename,file_sha256:appliedDataset.value.file_sha256,sheet:selectionIdentity.value.sheet,
  x_column:selectionIdentity.value.xColumn,y_column:selectionIdentity.value.yColumn}:null);
const loading=ref(false),previewLoading=ref(false),inputError=ref('');
async function importFile(file: File): Promise<void> {
  if (loading.value) return;
  loading.value = true; inputError.value = ""; selectionVersion++; previewLoading.value = false;
  try {
    const uploaded = await uploadDataset(file);
    dataset.value = uploaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件读取失败";
    inputError.value = `新文件读取失败：${message}${appliedDataset.value ? `；当前图表仍为 ${appliedDataset.value.filename}` : "；尚未应用数据"}`;
  } finally { loading.value = false; }
}
async function preview(selection: { sheet: string; xColumn: string; yColumn: string }): Promise<void> {
  if (!dataset.value) return;
  if(dataset.value.dataset_id.startsWith('session:')){inputError.value='会话已包含原谱快照；如需选择其他数据列，请重新导入原文件。';return;}
  const candidate=dataset.value;
  const version = ++selectionVersion;
  inputError.value = ""; previewLoading.value = true;
  try {
    const data = await previewDataset(candidate.dataset_id, selection.sheet, selection.xColumn, selection.yColumn);
    if (version !== selectionVersion) return;
    if(!await confirmDiscard(Object.values(singleWork.value).some(Boolean),'应用新数据将重置通用、XRD 和 XPS 单谱工作区的峰参数、背景复核及结果。批次数据保持独立。'))return;
    if(version!==selectionVersion)return;
    // 成功后一次提交数据及其身份，失败时保留上一份已应用数据。
    x.value = data.x; y.value = data.y; dataAudit.value=data.audit??null; appliedDataset.value=candidate; selectionIdentity.value = { ...selection };

  } catch (error) {
    if (version === selectionVersion) inputError.value = `数据列应用失败：${error instanceof Error ? error.message : "无法显示数据"}${selectionIdentity.value ? "；当前图表仍为上一次已应用数据" : "；请重新选择数据列"}`;
  } finally { if (version === selectionVersion) previewLoading.value = false; }
}

function captureSession():SingleSession|BatchSession{
  const child=(processing.value==='batch'?batchRefs:singleRefs).value[mode.value];
  if(!child)throw new Error('请先导入数据并设置当前工作区');
  const state=child.sessionState();if(state.kind==='single')state.audit=dataAudit.value;return state;
}
async function restoreSession(a:SessionArchive){
  const w=a.workspace,c=w.kind==='single'?w.configuration:w.template;
  const target=isMulti(c)?c.analysis_mode==='xrd'?'xrd':'single':'xps';
  if(w.kind==='batch'){
    mode.value=target;processing.value='batch';await nextTick();batchRefs.value[target]!.restoreSession(w);
  }else{
    selectionVersion++;workspaceEpoch.value++;singleRefs.value={};singleWork.value={single:false,xrd:false,xps:false};
    x.value=[...c.x];y.value=[...c.y];dataAudit.value=w.audit??null;
    const d=sessionDataset(c);dataset.value=d;appliedDataset.value=d;
    selectionIdentity.value={sheet:c.source?.sheet??'恢复谱线',xColumn:c.source?.x_column??'X',yColumn:c.source?.y_column??'Y'};
    inputError.value='';mode.value=target;processing.value='single';await nextTick();singleRefs.value[target]!.restoreSession(w);
  }
}
</script>
<template>
  <main class="analysis-workbench">
    <a class="skip-link" href="#workspace-content">跳转到分析工作区</a>
    <header class="workbench-header">
      <div class="product-identity"><span class="product-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M3 25h26M5 23c6 0 5-17 11-17s5 17 11 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 23c5 0 5-8 8-8s3 8 8 8" stroke="currentColor" stroke-width="1.5" stroke-dasharray="2 3"/></svg></span><div><h1>谱线拟合工作台</h1><p class="product-subtitle">材料表征 · 谱线分析与结果复核</p></div></div>
      <div class="local-status"><span class="local-dot"/>本机处理 <span class="storage-note">会话需手动保存</span></div>
    </header>
    <div class="workspace-context">
      <div class="header-status">
        <label class="mode-select">分析类型<select v-model="mode" :disabled="batchBusy" aria-label="分析类型" aria-describedby="workflow-description" data-test="analysis-mode"><option value="single">通用谱线</option><option value="xrd">XRD 峰拟合</option><option value="xps">XPS 峰拟合</option></select></label>
        <div class="processing-select" role="group" aria-label="处理方式"><span>处理方式</span><div class="processing-buttons"><button :aria-pressed="processing==='single'" :disabled="batchBusy" @click="processing='single'" data-test="processing-single">单谱拟合</button><button :aria-pressed="processing==='batch'" @click="processing='batch'" data-test="processing-batch">批量拟合</button></div></div>
      </div>
      <SessionActions :capture="captureSession" :restore="restoreSession" :busy="sessionBusy" />
    </div>
    <p id="workflow-description" class="workflow-description">{{workflowDescriptions[mode]}}<span v-if="batchBusy"> 批次处理中；完成或暂停后可切换。</span></p>
    <div id="workspace-content" tabindex="-1">
    <DatasetSummary v-show="processing==='single'" :dataset="dataset" :applied-dataset="appliedDataset" :analysis-mode="mode" :loading="loading" :preview-loading="previewLoading" :applied-selection="selectionIdentity" :point-count="x.length" :snapshot="{x,y}" :error="inputError" @upload="importFile" @preview="preview" @cancel="selectionVersion++;previewLoading=false;dataset=appliedDataset;inputError=''" />
    <DatasetAuditSummary v-if="processing==='single'&&selectionIdentity" :audit="dataAudit" />
    <nav v-if="processing==='single'" class="workspace-jump" aria-label="单谱工作区导航"><span>分析工作区</span><a href="#analysis-settings">01 设置与复核</a><a href="#analysis-plot">02 图谱检查</a><a href="#analysis-results">03 结果与归档</a></nav>
    <KeepAlive :key="`xps-${workspaceEpoch}`"><XpsWorkbench :ref="bindSingle('xps')" @work="singleWork.xps=$event" v-if="processing==='single'&&mode==='xps'" :x="x" :y="y" :source="xpsSource" @template="useBatchTemplate" /></KeepAlive>
    <KeepAlive :key="`multi-${workspaceEpoch}`"><MultiPeakWorkbench :ref="bindSingle(mode)" @work="singleWork[$event.mode]=$event.dirty" v-if="processing==='single'&&(mode==='single'||mode==='xrd')" :key="mode" unified :x="x" :y="y" :source="xpsSource" :mode="mode==='xrd'?'xrd':'general'" :data-loading="loading||previewLoading" @template="useBatchTemplate" /></KeepAlive>
    <BatchWorkbench :ref="el=>batchRefs[kind]=el as any" v-for="kind in analysisModes" :key="kind" v-show="processing==='batch'&&mode===kind" :analysis-mode="kind==='single'?'general':kind" :template="batchTemplates[kind]" @single="processing='single'" @activity="batchActivity[kind]=$event" />
    </div>
  </main>
</template>
