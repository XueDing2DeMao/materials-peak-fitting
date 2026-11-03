<script setup lang="ts">
import {usableBatchResult} from "../internalPeakAnalysis";
import ResultWorkspace from "./ResultWorkspace.vue";
import BatchBackgroundSettings from './BatchBackgroundSettings.vue';
import '../styles/batchReview.css';
import '../styles/batchSetup.css';
import { confirmDiscard, useWorkProtection } from '../useWorkProtection';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { uploadDataset, previewDataset } from '../api';
import { validateMultiInput } from '../multipeakApi';
import { validateXpsInput } from '../xpsApi';
import { clone } from '../multipeakState';
import { resultDiagnostics } from '../resultDiagnostics';
import { isMulti } from '../fitAdapter';
import { spectrumUnits } from '../spectrumUnits';
import BatchBackgroundOverview from './BatchBackgroundOverview.vue';
import DatasetAuditSummary from './DatasetAuditSummary.vue';
import type {DatasetAudit} from '../datasetAudit';
import BatchTrendChart from './BatchTrendChart.vue';
import BatchExportPanel from './BatchExportPanel.vue';
import BatchMetadataEditor from './BatchMetadataEditor.vue';
import { conditionAxis,emptyMetadata,trendUnit,type MetadataByTask,type TrendMetric } from '../batchTrend';
import BatchImportSelector from './BatchImportSelector.vue';
import { createSelection, sortSpectra, type SheetSelection, type SpectrumSelection, type SpectrumOrder } from '../batchSelection';
import { prepareRequest } from '../batchInput';
import { BatchRunner } from '../batchRunner';
import {normalizedBatchRows,type BatchSession} from '../sessionArchive';
import {sessionDataset} from '../sessionDataset';
import { readExperimentMetadata } from '../batchExperimentArchive';
import { exportBatch,exportBatchTrend } from '../batchExport';
import { readBatchTemplate } from '../batchTemplate';
import type { BatchRequest, BatchResult } from '../batchTypes';
import type { DatasetInfo } from '../types';
import type { MultiPreview, MultiResult } from '../multipeakTypes';
import type { XpsPreview, XpsResult } from '../xpsTypes';
import BatchResultChart from './BatchResultChart.vue';
import AnalysisReportActions from './AnalysisReportActions.vue';
import type {ReportEntry} from '../analysisReport';
import MultiPeakResults from './MultiPeakResults.vue';
import XpsResults from './XpsResults.vue';
const props=defineProps<{template:BatchRequest|null;analysisMode?:'general'|'xrd'|'xps'}>();
const emit=defineEmits<{single:[];activity:[busy:boolean];reviewLayout:[enabled:boolean];importLayout:[enabled:boolean]}>();
interface InputRow {id:string;originalOrder:number;dataset:DatasetInfo;sheet:string;xColumn:string;yColumn:string;columns:string[];included:boolean;error:string;request:BatchRequest|null;preview:MultiPreview|XpsPreview|null;confirmed:boolean}
const currentTemplate=ref<BatchRequest|null>(null),inputs=ref<InputRow[]>([]),run=ref<BatchRunner|null>(null),selected=ref(0);
type BatchView='import'|'review'|'results'|'trend'|'export';
const activeView=ref<BatchView>('import');
const configOpen=ref(false);
const configPanel=ref<HTMLElement|null>(null),configTrigger=ref<HTMLButtonElement|null>(null);
async function toggleConfig(open:boolean){
  configOpen.value=open;await nextTick();
  (open?configPanel.value:configTrigger.value)?.focus({preventScroll:true});
}
const overviewOpen=ref(false),thumbnailsOpen=ref(true),reviewPanelOpen=ref(false);
const queue=ref<HTMLElement|null>(null);
const trendPeak=ref(''),trendMetric=ref<TrendMetric>('position'),trendAxis=ref<'sequence'|'condition'>('sequence');
const trendNames={position:'峰顶位置',fwhm:'整体 FWHM',area_window:'区间面积',area_total:'全域面积'};
const trendPeaks=computed(()=>{const peaks=new Map<string,string>();for(const row of run.value?.rows??[])for(const peak of row.request.components)if(peak.enabled!==false)peaks.set(peak.id,peak.label);return peaks;});
watch(trendPeaks,peaks=>{if(!peaks.has(trendPeak.value))trendPeak.value=peaks.keys().next().value??'';});
const busy=ref(false),error=ref(''),unitsConfirmed=ref(false),fixedBaseline=ref(false),sequential=ref(true),fileInput=ref<HTMLInputElement|null>(null),editRequest=ref<BatchRequest|null>(null);
let revision=0,nextOrder=0;
const restoredReview=ref(false),restoredBatch=ref(false);
const drafts=ref<SheetSelection[]>([]),order=ref<SpectrumOrder|'condition'>('original'),orderOpen=ref(false);
const metadata=ref<MetadataByTask>({}),metadataInput=ref<HTMLInputElement|null>(null),metadataMessage=ref('');
const audits=ref<Record<string,DatasetAudit|null>>({});
async function loadMetadata(event:Event){
  const control=event.target as HTMLInputElement,file=control.files?.[0];if(!file||busy.value||active.value)return;
  busy.value=true;metadataMessage.value='';error.value='';const version=revision;
  try{
    if(file.size>100*1024*1024)throw new Error('实验记录 JSON 超过 100 MiB，请使用较小批次文件');
    const targets=included.value.map(r=>({id:r.id,source:r.dataset.file_sha256?{filename:r.dataset.filename,file_sha256:r.dataset.file_sha256,sheet:r.sheet,x_column:r.xColumn,y_column:r.yColumn}:null}));
    const loaded=readExperimentMetadata(JSON.parse(await file.text()),targets);if(version!==revision)return;
    if(!Object.keys(loaded).length){metadataMessage.value='此文件未提供实验记录，当前记录保持不变。';return;}
    const changed=Object.keys(loaded).some(id=>{const m=metadata.value[id];return m&&Object.values(m).some(v=>v!==''&&v!==null);});
    if(!await confirmDiscard(changed,'载入将替换匹配谱线的实验记录；原谱、背景复核和拟合结果保持不变。'))return;
    if(version!==revision)return;Object.assign(metadata.value,loaded);orderOpen.value=false;metadataMessage.value=`已按原文件哈希和谱列匹配 ${Object.keys(loaded).length} 条实验记录。`;
  }catch(e){error.value=`实验记录载入失败：${e instanceof Error?e.message:String(e)}`;}finally{busy.value=false;control.value='';}
}
const orderCondition=computed(()=>conditionAxis(inputs.value.map(r=>metadata.value[r.id]??emptyMetadata())));
const ordered=computed(()=>order.value==='condition'?[...inputs.value].sort((a,b)=>(metadata.value[a.id]?.condition_value??0)-(metadata.value[b.id]?.condition_value??0)||a.originalOrder-b.originalOrder):sortSpectra(inputs.value,order.value));
function applyOrder(){if(busy.value||locked.value||order.value==='condition'&&!orderCondition.value.available)return;inputs.value=ordered.value;selected.value=0;orderOpen.value=false;invalidate();}
function commitSelection(rows:SpectrumSelection[]){
  if(busy.value||locked.value)return;
  if(included.value.length+rows.length>100){error.value='实际纳入谱线超过 100 条，请减少选择。';return;}
  invalidate();inputs.value.push(...rows.map(row=>({...row,id:crypto.randomUUID(),originalOrder:nextOrder++,included:true,error:'',request:null,preview:null,confirmed:false})));
  for(const row of inputs.value)metadata.value[row.id]??=emptyMetadata();
  drafts.value=[];importMessage.value=`已新增 ${rows.length} 条谱线，请核对执行顺序。`;
}
const active=computed(()=>Boolean(run.value&&['running','pausing','stopping'].includes(run.value.status)));
useWorkProtection(()=>active.value||inputs.value.length>0||drafts.value.length>0||Boolean(currentTemplate.value));
const locked=computed(()=>Boolean(run.value));
const templateInput=ref<HTMLInputElement|null>(null);
const analysisMode=computed(()=>props.analysisMode??(currentTemplate.value?(isMulti(currentTemplate.value)?currentTemplate.value.analysis_mode:'xps'):'general'));
const analysisName=computed(()=>({general:'通用谱线',xrd:'XRD',xps:'XPS'})[analysisMode.value]);
watch(()=>busy.value||active.value,value=>emit('activity',value),{immediate:true});
const selectedInput=computed(()=>inputs.value.filter(r=>r.included)[selected.value]);
const selectedRun=computed(()=>run.value?.rows[selected.value]);
const shownRequest=computed(()=>activeView.value==='review'?selectedInput.value?.request??null:selectedRun.value?.request??selectedInput.value?.request??null);
const shownResult=computed<BatchResult|null>(()=>activeView.value==='review'?null:selectedRun.value?.result??null);
const shownPreview=computed(()=>activeView.value==='review'?selectedInput.value?.preview??selectedRun.value?.result??null:shownResult.value??selectedInput.value?.preview??null);
const ready=computed(()=>!drafts.value.length&&inputs.value.some(r=>r.included)&&inputs.value.filter(r=>r.included).every(r=>r.request&&r.preview&&r.confirmed&&!r.error));
const statusLabels:Record<string,string>={ready:'就绪',running:'运行中',pausing:'暂停中（等待当前谱）',paused:'已暂停',stopping:'停止中（等待当前谱）',stopped:'已停止',done:'已结束',pending:'待执行',success:'已完成计算',review:'待复核',failed:'失败',skipped:'已跳过'};
const settingsOpen=ref(true),search=ref(''),statusFilter=ref('all');
const detailTab=ref<'parameters'|'attempts'|'configuration'>('parameters'),selectedPeak=ref('');
const resultsExpanded = ref(false);
const reviewMessage=ref(''),reviewUndo=ref<string[]>([]);
const bulkReviewOpen=ref(false),bulkSelection=ref(new Set<string>());
const bulkTrigger=ref<HTMLButtonElement|null>(null),overviewTrigger=ref<HTMLButtonElement|null>(null);
const preflightFinished=ref(false),busyMessage=ref(''),importMessage=ref(''),dragging=ref(false);
const importSection=ref<HTMLElement|null>(null),flowHeader=ref<HTMLElement|null>(null);
const included=computed(()=>inputs.value.filter(row=>row.included));
const reviewLayout=computed(()=>activeView.value==='review'&&included.value.length>0);
watch(reviewLayout,value=>emit('reviewLayout',value),{immediate:true});
watch(()=>activeView.value==='import',value=>emit('importLayout',value),{immediate:true});
const mappedCount=computed(()=>included.value.filter(row=>row.xColumn!==row.yColumn&&row.columns.includes(row.xColumn)&&row.columns.includes(row.yColumn)).length);
function mappingStatus(row:InputRow){return row.error?'预检失败':row.xColumn===row.yColumn?'X / Y 相同':row.preview?'预检通过':'已映射 · 待预检';}
const reportEntries=computed<ReportEntry[]>(()=>run.value?.rows.map(r=>({
  label:r.label,status:statusLabels[r.status],
  snapshot:r.result?{engine:isMulti(r.result.configuration)?'multi':'xps',configuration:r.result.configuration,result:r.result,stale:r.status==='pending',accepted:r.attempts.some(a=>a.id===r.accepted_attempt_id&&a.manually_accepted)}:null,
  note:JSON.stringify({experiment:metadata.value[r.id],attempts:r.attempts.map(a=>({id:a.id,parent_task_id:a.parent_task_id,parent_attempt_id:a.parent_attempt_id,initialization_source:a.initialization_source,invalidated:a.invalidated,manually_accepted:a.manually_accepted,error:a.error,warnings:a.warnings}))})
}))??[]);
const overviewRows=computed(()=>included.value.map((row,index)=>({id:row.id,index,label:`${row.dataset.filename} / ${row.sheet} / ${row.yColumn}`,error:row.error,confirmed:row.confirmed,preview:row.preview??run.value?.rows[index]?.result??null})));
const metadataRows=computed(()=>included.value.map(row=>({id:row.id,label:`${row.dataset.filename} / ${row.yColumn}`})));
const detailHeading=ref<HTMLElement|null>(null);
const resultViews=ref<{showResults:()=>void;showArchive:()=>void}|null>(null);
async function locateSpectrum(index:number,peak=''){selected.value=index;overviewOpen.value=false;search.value='';statusFilter.value='all';detailTab.value='parameters';await nextTick();resultViews.value?.showResults();selectedPeak.value=peak;if(!reviewLayout.value)detailHeading.value?.scrollIntoView?.({block:'start',behavior:'smooth'});detailHeading.value?.focus({preventScroll:true});}
function locateTrend(id:string,peak:string){const i=included.value.findIndex(r=>r.id===id);if(i>=0){activeView.value='results';void locateSpectrum(i,peak);}}
const reviewable=computed(()=>included.value.filter(row=>row.request&&row.preview&&!row.error));
const unconfirmed=computed(()=>reviewable.value.filter(row=>!row.confirmed));
const failedInputs=computed(()=>included.value.filter(row=>row.error));
const fileCount=computed(()=>new Set(inputs.value.map(row=>row.dataset.dataset_id)).size);
const sheetCount=computed(()=>new Set(inputs.value.map(row=>`${row.dataset.dataset_id}:${row.sheet}`)).size);
const trendCondition=computed(()=>conditionAxis((run.value?.rows??[]).map(row=>metadata.value[row.id]??emptyMetadata())));
watch(trendCondition,c=>{if(!c.available)trendAxis.value='sequence';});
const trendLabel=computed(()=>{
  const valueUnits=new Set((run.value?.rows??[]).map(row=>trendUnit(row,trendMetric.value,unit.value)));
  return `${trendPeak.value||'未选择峰'} · ${trendNames[trendMetric.value]} / ${valueUnits.size>1?'各谱单位见趋势表':[...valueUnits][0]??unit.value} · ${trendAxis.value==='condition'?trendCondition.value.label:'执行序号'}`;
});
const flowItems=computed(()=>[
  {id:'import' as const,label:'导入与配置',hint:inputs.value.length?`${included.value.length} 条谱线`:'选择数据',disabled:false},
  {id:'review' as const,label:'背景复核',hint:preflightFinished.value?`${reviewable.value.length-unconfirmed.value.length} / ${included.value.length}`:'等待预检',disabled:!preflightFinished.value&&!run.value},
  {id:'results' as const,label:'拟合结果',hint:run.value?statusLabels[run.value.status]:'等待运行',disabled:!run.value},
  {id:'trend' as const,label:'峰参数趋势',hint:run.value?`${run.value.rows.length} 条谱线可比较`:'等待运行',disabled:!run.value},
  {id:'export' as const,label:'导出结果',hint:'拟合结果与趋势数据',disabled:!run.value},
]);
const panelId=(view:BatchView)=>`batch-panel-${view==='review'||view==='results'?'detail':view}-${analysisMode.value}`;
function changeView(view:BatchView){
  if(flowItems.value.find(item=>item.id===view)?.disabled)return;
  if(view==='review'&&statusFilter.value==='success'||view==='results'&&statusFilter.value==='ready')statusFilter.value='all';
  activeView.value=view;settingsOpen.value=view==='import';
  overviewOpen.value=false;reviewPanelOpen.value=false;
}
function navigateTabs(event:KeyboardEvent){
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
  const tabs=Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role=tab]:not(:disabled)'));
  const index=tabs.indexOf(event.target as HTMLButtonElement);if(index<0)return;
  event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
  tabs[next].click();tabs[next].focus();
}
const explicitAnchors=computed(()=>{
  const template=currentTemplate.value;
  return Boolean(template&&isMulti(template)&&template.baseline.kind!=='none'&&template.baseline.anchors.length);
});
// 逐谱背景会重新估计端点水平；预先提示缺少窗口，避免整批运行后才发现。
const missingBackgroundWindows=computed(()=>{
  const t=currentTemplate.value;
  return Boolean(t&&!isMulti(t)&&t.background.kind!=='none'&&!fixedBaseline.value&&(!t.background.low_window||!t.background.high_window));
});
const prepareHint=computed(()=>drafts.value.length?'请先纳入所选谱线或取消本次导入。':included.value.length>100?'实际纳入谱线超过 100 条，请减少选择。':!included.value.length?'请至少纳入一条谱线。':!unitsConfirmed.value?'请先核对并勾选 X 单位、区间一致。':
  explicitAnchors.value&&!fixedBaseline.value?'模板含显式锚点：背景相同时可选择固定绝对背景；否则请返回单谱工作区重新配置模板。':'列映射和顺序确认后，预检将检查每条谱线并进入背景复核。');
const canPrepare=computed(()=>Boolean(currentTemplate.value&&included.value.length&&included.value.length<=100&&!drafts.value.length&&unitsConfirmed.value&&(!explicitAnchors.value||fixedBaseline.value)&&!busy.value&&!locked.value));
const nextStepText=computed(()=>restoredReview.value&&reviewable.value.length<included.value.length?'恢复背景尚未全部重新预览，请先点击“重新预览恢复背景”。':drafts.value.length?'请先纳入所选谱线或取消本次导入，再开始拟合。':failedInputs.value.length?`${failedInputs.value.length} 条预检失败，请修改数据配置后重新预检。`:
  ready.value?`${included.value.length} 条背景已复核，可以开始拟合。`:`${unconfirmed.value.length} 条背景待复核；可逐谱确认，也可一键全部复核。`);
async function openImport(){changeView('import');await nextTick();importSection.value?.scrollIntoView?.({block:'start',behavior:'smooth'});}
async function showReview(){
  if(!preflightFinished.value&&!run.value)return;
  changeView('review');await nextTick();flowHeader.value?.scrollIntoView?.({block:'start',behavior:'smooth'});
}
function importAction(){if(currentTemplate.value&&!inputs.value.length)fileInput.value?.click();else void openImport();}
function confirmAndNext(){
  const row=selectedInput.value;
  if(!row||busy.value||locked.value&&!restoredReview.value||!row.request||!row.preview||row.error)return;
  setReview(row,true);
  const index=included.value.findIndex((item,i)=>i>selected.value&&item.preview&&!item.confirmed&&!item.error);
  const remaining=index>=0?index:included.value.findIndex(item=>item.preview&&!item.confirmed&&!item.error);
  if(remaining>=0){search.value='';statusFilter.value='all';selected.value=remaining;reviewMessage.value=`第 ${included.value.indexOf(row)+1} 条已复核，已定位下一条待复核谱线。`;}
  else reviewMessage.value=failedInputs.value.length?'有效背景已全部复核；仍有预检失败谱线，请返回修改数据。':'全部背景已复核，可以开始批量拟合。';
}
function rowStatus(index:number){
  const row=included.value[index];
  return (activeView.value==='review'?null:run.value?.rows[index]?.status)??(row?.error?'failed':row?.preview?(row.confirmed?'ready':'review'):'pending');
}
const visibleRows=computed(()=>included.value.map((row,index)=>({row,index,status:rowStatus(index)})).filter(({row,status})=>
  (statusFilter.value==='all'||status===statusFilter.value)&&
  `${row.dataset.filename} ${row.sheet} ${row.yColumn}`.toLowerCase().includes(search.value.trim().toLowerCase())));
const reviewLocked=computed(()=>busy.value||locked.value&&!restoredReview.value);
const selectedForReview=computed(()=>unconfirmed.value.filter(row=>bulkSelection.value.has(row.id)));
const visibleForReview=computed(()=>visibleRows.value.filter(item=>item.status==='review'&&item.row.request&&!item.row.confirmed));
const hiddenReviewSelection=computed(()=>selectedForReview.value.filter(row=>!visibleRows.value.some(item=>item.row.id===row.id)).length);
const bulkReviewLabel=computed(()=>included.value.length>0&&reviewable.value.length===included.value.length&&!unconfirmed.value.length?'全部已复核':!unconfirmed.value.length?'无可复核项':`批量复核（${unconfirmed.value.length}）`);
watch(unconfirmed,rows=>{const valid=new Set(rows.map(row=>row.id));bulkSelection.value=new Set([...bulkSelection.value].filter(id=>valid.has(id)));});
watch(activeView,view=>{if(view!=='review'){bulkReviewOpen.value=false;bulkSelection.value.clear();}});
function chooseForReview(row:InputRow,event:Event){
  if(reviewLocked.value||!unconfirmed.value.includes(row))return;
  if((event.target as HTMLInputElement).checked)bulkSelection.value.add(row.id);else bulkSelection.value.delete(row.id);
}
function selectVisibleForReview(){if(!reviewLocked.value)for(const {row} of visibleForReview.value)bulkSelection.value.add(row.id);}
async function closeBulkReview(){bulkReviewOpen.value=false;await nextTick();(bulkTrigger.value?.disabled?overviewTrigger.value:bulkTrigger.value)?.focus({preventScroll:true});}
const counts=computed(()=>{
  const statuses=run.value?.rows.map(row=>row.status)??[];
  return {calculated:statuses.filter(s=>['success','review','failed'].includes(s)).length,
    success:statuses.filter(s=>s==='success').length,review:statuses.filter(s=>s==='review').length,
    failed:statuses.filter(s=>s==='failed').length,pending:statuses.filter(s=>s==='pending').length,
    skipped:statuses.filter(s=>s==='skipped').length};
});
function locateFailure() {
  const rows = run.value?.rows ?? [];
  let index = rows.findIndex((row, i) => i > selected.value && row.status === 'failed');
  if (index < 0) index = rows.findIndex(row => row.status === 'failed');
  if (index < 0) return;
  changeView('results');
  void locateSpectrum(index);
}
const latestAttempt=computed(()=>selectedRun.value?.attempts.filter(a=>!a.invalidated).at(-1));
const selectedWarnings=computed(()=>[...new Set([
  selectedInput.value?.error,latestAttempt.value?.error,...(latestAttempt.value?.warnings??[]),
  ...(shownResult.value?resultDiagnostics(shownResult.value).warnings:[]),
].filter((message):message is string=>Boolean(message)))]);
const diagnosis=computed(()=>resultDiagnostics(shownResult.value,{busy:selectedRun.value?.status==='running',accepted:latestAttempt.value?.manually_accepted}));
const sourceLabels:Record<string,string>={template:'模板',previous_result:'上一条结果',continuation:'本条续算'};
const units=computed(()=>spectrumUnits(analysisMode.value,(shownRequest.value??currentTemplate.value)?.source));
const unit=computed(()=>units.value.x);
const formatNumber=(value:number|null|undefined)=>value==null||!Number.isFinite(value)?'—':Number(value.toPrecision(6)).toString();
const previousIndex=computed(()=>[...visibleRows.value].reverse().find(item=>item.index<selected.value)?.index);
const nextIndex=computed(()=>visibleRows.value.find(item=>item.index>selected.value)?.index);
const nextReviewIndex=computed(()=>{
  const review= included.value.map((_,index)=>index).filter(index=>rowStatus(index)==='review');
  return review.find(index=>index>selected.value)??review.find(index=>index!==selected.value);
});
function selectRow(index:number|undefined){if(index!==undefined)selected.value=index;}
function navigateReview(event:KeyboardEvent){
  if(!reviewLayout.value||overviewOpen.value||event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
  const target=event.target as HTMLElement;
  if(target.closest('input,select,textarea,[contenteditable]:not([contenteditable="false"]),[role="slider"],.js-plotly-plot,[role="tablist"]'))return;
  if(!['ArrowLeft','ArrowRight'].includes(event.key))return;
  event.preventDefault();selectRow(event.key==='ArrowLeft'?previousIndex.value:nextIndex.value);
}
watch([selected,visibleRows],async()=>{
  await nextTick();
  const list=queue.value,item=list?.querySelector<HTMLElement>(`[data-row-index="${selected.value}"]`);
  if(!list||!item)return;
  const top=item.getBoundingClientRect().top-list.getBoundingClientRect().top+list.scrollTop;
  if(top<list.scrollTop)list.scrollTop=top;
  else if(top+item.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=top+item.offsetHeight-list.clientHeight;
},{flush:'post'});
async function navigateList(event:KeyboardEvent){
  if((event.target as HTMLElement).tagName!=='BUTTON'||!['ArrowUp','ArrowDown'].includes(event.key))return;
  const list=event.currentTarget as HTMLElement;
  event.preventDefault();selectRow(event.key==='ArrowUp'?previousIndex.value:nextIndex.value);
  await nextTick();
  const button=list.querySelector<HTMLButtonElement>(`[data-test="batch-view-${selected.value+1}"]`);
  button?.focus({preventScroll:true});button?.scrollIntoView?.({block:'nearest'});
}
function confirmAll(){
  applyBulkReview(unconfirmed.value);
}
function applyBulkReview(rows:InputRow[]){
  if(reviewLocked.value)return;
  const targets=rows.filter(row=>unconfirmed.value.includes(row));
  if(!targets.length)return;
  reviewUndo.value=targets.map(row=>row.id);
  for(const row of targets)row.confirmed=true;
  bulkSelection.value.clear();
  const skipped=included.value.length-reviewable.value.length;
  reviewMessage.value=`已标记 ${reviewUndo.value.length} 条背景为已复核${skipped?`；跳过 ${skipped} 条预检未通过的谱线`:''}。`;
}
function undoReview(){
  if(locked.value&&!restoredReview.value||busy.value)return;
  for(const row of included.value)if(reviewUndo.value.includes(row.id))row.confirmed=false;
  reviewUndo.value=[];reviewMessage.value='已撤销本次批量复核，保留原先已复核的谱线。';
}
function invalidate(){bulkReviewOpen.value=false;bulkSelection.value.clear();revision++;activeView.value='import';trendPeak.value='';trendMetric.value='position';trendAxis.value='sequence';audits.value={};preflightFinished.value=false;settingsOpen.value=true;reviewUndo.value=[];reviewMessage.value='';selected.value=Math.min(selected.value,Math.max(0,included.value.length-1));for(const r of inputs.value){r.request=null;r.preview=null;r.confirmed=false;r.error='';}}
watch(()=>props.template,async t=>{
  if(active.value||busy.value){error.value='当前批次正在运行；请先暂停，再重新发送模板。';return;}
  if((run.value||preflightFinished.value)&&!await confirmDiscard(true,'更换模板将清除当前批次结果与背景复核，保留已导入谱线。'))return;
  if(t!==props.template||active.value||busy.value)return;
  currentTemplate.value=t?clone(t):null;run.value=null;invalidate();error.value='';settingsOpen.value=true;
},{immediate:true});
watch([fixedBaseline,unitsConfirmed],()=>{if(!locked.value)invalidate();});
// 编辑草稿跟随谱线及真实配置，浏览背景页不应覆盖尚未应用的初值。
watch(()=>selectedRun.value?.request??selectedInput.value?.request??null,r=>{editRequest.value=r?clone(r):null;});
watch(selected,()=>{selectedPeak.value='';});
onBeforeUnmount(()=>{revision++;run.value?.stop();});
async function loadTemplate(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||busy.value||locked.value)return;
  busy.value=true;error.value='';
  try{
    const template=readBatchTemplate(JSON.parse(await file.text()),analysisMode.value);
    // 后端完整检查模型、数值与背景；成功前不替换现有模板和预检结果。
    if(isMulti(template))await validateMultiInput(template);else await validateXpsInput(template);
    if(!await confirmDiscard(preflightFinished.value,'更换模板将清除现有背景预检与复核。'))return;
    currentTemplate.value=template;invalidate();selected.value=0;
  }catch(e){error.value=e instanceof SyntaxError?'模板 JSON 格式无效，请检查文件内容后重新选择。当前模板保持不变。':`模板载入失败：${e instanceof Error?e.message:String(e)}`;}
  finally{busy.value=false;input.value='';}
}
async function upload(event:Event){
  const control=event.target as HTMLInputElement;
  await uploadFiles(Array.from(control.files??[]));control.value='';
}
async function dropFiles(event:DragEvent){dragging.value=false;await uploadFiles(Array.from(event.dataTransfer?.files??[]));}
async function uploadFiles(files:File[]){
  if(!files.length||busy.value||locked.value||!currentTemplate.value)return;
  busy.value=true;error.value='';importMessage.value='';
  const failures:string[]=[];let addedFiles=0;
  try{for(const [index,file] of files.entries()){
    busyMessage.value=`正在读取 ${index+1} / ${files.length}：${file.name}`;
    try{
      const d=await uploadDataset(file),selection=createSelection(d);
      if(!selection.length)throw new Error('未找到可组成 X / Y 的数值列');
      drafts.value.push(...selection);addedFiles++;
    }catch(e){failures.push(`${file.name}：${e instanceof Error?e.message:String(e)}`);}
  }}finally{
    busy.value=false;busyMessage.value='';error.value=failures.join('；');
    importMessage.value=`本次已读取 ${addedFiles} 个文件，请选择需要纳入的原谱列${failures.length?`；${failures.length} 个文件读取失败`:''}。`;
  }
}
function move(index:number,offset:number){const next=index+offset;if(next<0||next>=inputs.value.length)return;const [row]=inputs.value.splice(index,1);inputs.value.splice(next,0,row);selected.value=0;invalidate();}
async function prepare(){
  if(!currentTemplate.value||!canPrepare.value)return;
  invalidate();const version=revision,template=clone(currentTemplate.value);busy.value=true;error.value='';selected.value=0;
  let points=0,curveValues=0;
  try{for(const row of inputs.value.filter(r=>r.included)){
    busyMessage.value=`正在预检 ${included.value.indexOf(row)+1} / ${included.value.length}：${row.yColumn}`;
    try{
      const data=await previewDataset(row.dataset.dataset_id,row.sheet,row.xColumn,row.yColumn);if(version!==revision)return;
      audits.value[row.id]=data.audit??null;
      points+=data.x.length;curveValues+=data.x.length*(template.components.filter(c=>c.enabled).length+4);
      if(points>200000||curveValues>2000000)throw new Error('数据超过当前批次内存限额，请减少谱线或数据点');
      if(!row.dataset.file_sha256)throw new Error('导入结果缺少原文件哈希，请重新导入');
      const request=prepareRequest(template,data,{filename:row.dataset.filename,file_sha256:row.dataset.file_sha256,sheet:row.sheet,x_column:row.xColumn,y_column:row.yColumn},fixedBaseline.value);
      const p=isMulti(request)?await validateMultiInput(request):await validateXpsInput(request);if(version!==revision)return;
      row.request=request;row.preview=p;row.confirmed=(isMulti(request)?request.baseline.kind:request.background.kind)==='none';
    }catch(e){row.error=e instanceof Error?e.message:String(e);}
  }}finally{
    busy.value=false;busyMessage.value='';
    if(version===revision){
      preflightFinished.value=true;search.value='';statusFilter.value='all';
      const failed=included.value.findIndex(row=>row.error);
      const pending=included.value.findIndex(row=>!row.confirmed);
      selected.value=failed>=0?failed:Math.max(0,pending);
      await showReview();
    }
  }
}
function confirm(row:InputRow,event:Event){
  setReview(row,(event.target as HTMLInputElement).checked);
}
function setReview(row:InputRow,checked:boolean){
  if(locked.value&&!restoredReview.value||busy.value||!row.preview||row.error)return;
  row.confirmed=checked;
  reviewUndo.value=reviewUndo.value.filter(id=>id!==row.id);
  reviewMessage.value=`第 ${included.value.indexOf(row)+1} 条背景${checked?'已复核':'已撤销复核'}。`;
}
async function start(){
  if(busy.value||active.value)return;error.value='';
  if(restoredReview.value){if(!ready.value){error.value='请重新预览并复核全部恢复背景';return;}for(const row of run.value!.rows){if(isMulti(row.request))row.request.baseline.confirmed=true;else row.request.background.confirmed=true;}restoredReview.value=false;}
  try{
    if(!run.value){
      if(!ready.value)return;
      const rows=inputs.value.filter(r=>r.included).map(r=>{
        const request=clone(r.request!);if(isMulti(request))request.baseline.confirmed=r.confirmed;else request.background.confirmed=r.confirmed;
        return {id:r.id,label:`${r.dataset.filename} / ${r.sheet} / ${r.yColumn}`,request};
      });
      run.value=new BatchRunner(rows,undefined,sequential.value);
    }
    changeView('results');reviewUndo.value=[];reviewMessage.value='';
    const batch=run.value;
    await batch.start();
  }catch(e){error.value=e instanceof Error?e.message:String(e);run.value?.stop();}
}
async function clear(){if(active.value||busy.value)return;if((run.value||preflightFinished.value)&&!await confirmDiscard(true,`新建批次将清空 ${run.value?.rows.filter(r=>r.result).length??0} 条结果、尝试记录和 ${reviewable.value.filter(r=>r.confirmed).length} 条背景复核；${restoredBatch.value?'恢复的批次需重新导入原文件。':'保留已导入文件与列选择。'}`))return;run.value=null;if(restoredBatch.value)inputs.value=[];restoredBatch.value=false;restoredReview.value=false;invalidate();selected.value=0;settingsOpen.value=true;search.value='';statusFilter.value='all';importMessage.value='';}
function rewind(){if(restoredReview.value){error.value='请先重新预览并复核背景，再继续或调整重跑';return;}try{if(run.value&&editRequest.value)run.value.rewind(selected.value,editRequest.value);}catch(e){error.value=e instanceof Error?e.message:String(e);}}
const exportMessage=ref(''),exportError=ref('');
function clearExportFeedback(){exportMessage.value='';exportError.value='';}
watch(()=>[run.value?.id,selected.value,trendPeak.value,trendMetric.value,trendAxis.value],clearExportFeedback);
function downloadFit(scope:'current'|'all',kind:'curves'|'parameters'|'configuration'){
  clearExportFeedback();
  const batch=run.value;if(!batch||scope==='current'&&!selectedRun.value)return;
  try{
    const snapshot=scope==='all'?batch:{...batch,rows:[selectedRun.value!]};
    exportBatch(snapshot,kind==='configuration'?'json':kind,metadata.value);
    exportMessage.value='已发起'+(scope==='all'?'整个批次':'当前谱线')+'的'+({curves:'曲线 CSV',parameters:'参数 CSV',configuration:'追溯 JSON'}[kind])+' 下载，请在浏览器下载列表中查看。';
  }catch(e){exportError.value='导出失败：'+(e instanceof Error?e.message:String(e));}
}
function downloadTrend(){
  clearExportFeedback();if(!run.value||!trendPeaks.value.has(trendPeak.value))return;
  try{
    exportBatchTrend(run.value.rows,metadata.value,{peak:trendPeak.value,metric:trendMetric.value,axis:trendAxis.value,unit:unit.value});
    exportMessage.value='已发起当前趋势数据 CSV 的下载，请在浏览器下载列表中查看。';
  }catch(e){exportError.value='导出失败：'+(e instanceof Error?e.message:String(e));}
}
function inspectExportStatus(status:'review'|'failed',scope:'current'|'all'){
  const index=scope==='current'?selected.value:run.value?.rows.findIndex(row=>row.status===status)??-1;
  if(index<0||run.value?.rows[index]?.status!==status)return;
  changeView('results');void locateSpectrum(index);
}

function sessionState():BatchSession{
  if(!currentTemplate.value||drafts.value.length||!included.value.length||included.value.some(r=>!r.request||r.error))throw new Error('保存前请纳入所选谱线并完成全部有效预检；未纳入草稿不属于会话。');
  const batch=run.value??new BatchRunner(included.value.map(r=>({id:r.id,label:`${r.dataset.filename} / ${r.sheet} / ${r.yColumn}`,request:r.request!})),undefined,sequential.value);
  return clone({kind:'batch',template:currentTemplate.value,batch_id:batch.id,status:batch.status,sequential:batch.sequential,rows:batch.rows,metadata:metadata.value,audits:audits.value});
}
function restoreSession(w:BatchSession){
  bulkReviewOpen.value=false;bulkSelection.value.clear();
  const rows=normalizedBatchRows(w.rows),runner=BatchRunner.restore(rows,w.batch_id,w.sequential);
  const restoredInputs:InputRow[]=rows.map((row,i)=>({id:row.id,originalOrder:i,dataset:sessionDataset(row.request),sheet:row.request.source?.sheet??'恢复谱线',xColumn:row.request.source?.x_column??'X',yColumn:row.request.source?.y_column??'Y',columns:[row.request.source?.x_column??'X',row.request.source?.y_column??'Y'],included:true,error:'',request:row.request,preview:null,confirmed:false}));
  revision++;currentTemplate.value=clone(w.template);run.value=runner;inputs.value=restoredInputs;nextOrder=inputs.value.length;
  metadata.value=clone(w.metadata);audits.value=clone(w.audits);sequential.value=w.sequential;drafts.value=[];
  selected.value=Math.min(runner.index,rows.length-1);settingsOpen.value=false;preflightFinished.value=true;search.value='';statusFilter.value='all';error.value='';reviewUndo.value=[];
  restoredBatch.value=true;restoredReview.value=true;reviewMessage.value='会话已恢复，历史结果与人工接受记录保留；未发起计算。继续前请重新预览并复核全部背景。';
  activeView.value='review';trendPeak.value='';trendMetric.value='position';trendAxis.value='sequence';
}
async function reviewRestored(){
  if(!restoredReview.value||busy.value||active.value)return;
  changeView('review');
  const version=revision;busy.value=true;error.value='';
  try{for(const row of included.value){row.confirmed=false;row.preview=null;row.error='';try{const request=clone(row.request!);row.preview=isMulti(request)?await validateMultiInput(request):await validateXpsInput(request);}catch(e){row.error=String(e);}if(version!==revision)return;}}
  finally{busy.value=false;}
}
defineExpose({sessionState,restoreSession,materialResultHint:()=>run.value?.rows.some(usableBatchResult)?'':'请先完成拟合；当前批次没有可用且未失效的结果。',isBusy:()=>busy.value||active.value});
</script>
<template>
<section class="batch-workbench" :class="{'is-review-workbench':reviewLayout,'is-import-workbench':activeView==='import','is-results-workbench':activeView==='results','results-expanded':resultsExpanded}">
  <div ref="flowHeader" class="panel batch-header">
    <div class="batch-toolbar">
      <div><h2>批量拟合</h2><p class="hint" data-test="batch-context">{{analysisName}} · {{sequential?'顺序拟合':'独立拟合'}}</p></div>
      <div class="xps-actions">
        <button v-if="activeView!=='import'&&!run&&!preflightFinished" class="primary" :disabled="busy" @click="importAction">{{!currentTemplate?'设置拟合模板':inputs.length?'核对数据与配置':'添加数据文件'}}</button>
        <button v-show="activeView!=='import'&&(run||preflightFinished)" class="primary" :disabled="busy||active||(restoredReview&&!ready)||(!run&&!ready)||(run?.status==='done'&&!restoredReview)" @click="start" data-test="batch-start">{{run?.status==='done'?(restoredReview?'完成恢复复核':'批次计算已结束'):run?'继续批量拟合':'开始批量拟合'}}</button>
        <button v-if="run&&counts.failed&&!active" @click="locateFailure" data-test="batch-locate-failure">处理失败项（{{counts.failed}}）</button>
        <button v-if="active" @click="run?.pause()">当前谱完成后暂停</button>
        <button v-if="active" @click="run?.stop()">当前谱完成后停止</button>
        <details class="batch-menu"><summary>更多操作</summary><div class="batch-menu-content"><p v-if="run" class="hint">默认连续计算，异常结果不继承。暂停／停止在当前谱求解返回后生效。</p><button :disabled="!included.length||busy||active" @click="metadataInput?.click()">载入实验记录 JSON</button><input ref="metadataInput" data-test="batch-metadata-file" type="file" accept=".json,application/json" hidden @change="loadMetadata" /><button :disabled="busy||active" @click="clear">新建批次（清空当前结果）</button></div></details>
      </div>
    </div>
    <p v-if="restoredReview" class="confirmation-callout"><span>会话已恢复；继续计算或调整结果前，请重新预览和复核背景。</span> <button :disabled="busy||active" @click="reviewRestored">重新预览恢复背景</button></p>
    <nav class="batch-flow" role="tablist" aria-label="批量拟合流程" @keydown="navigateTabs">
      <button v-for="(item,i) in flowItems" :key="item.id" type="button" role="tab" :id="`batch-tab-${item.id}-${analysisMode}`" :aria-controls="panelId(item.id)" :title="item.hint" :aria-selected="activeView===item.id" :aria-current="activeView===item.id?'step':undefined" :tabindex="activeView===item.id?0:-1" :disabled="item.disabled" @click="changeView(item.id)" :data-test="`batch-step-${item.id}`"><span class="batch-step-number" aria-hidden="true">{{i+1}}</span><span class="batch-flow-label">{{item.label}}<small>{{item.hint}}</small></span></button>
    </nav>
    <p v-if="run" role="status" data-test="batch-status" class="batch-progress">
      <strong>{{statusLabels[run.status]}}</strong> · 已计算 {{counts.calculated}} / {{run.rows.length}} 条 · 已完成计算 {{counts.success}} · 待复核 {{counts.review}} · 失败 {{counts.failed}} · 待执行 {{counts.pending}} · 已跳过 {{counts.skipped}}
      <span v-if="active"> · 当前执行第 {{run.index+1}} 条</span>
    </p>
    <p v-else-if="!preflightFinished" class="hint">{{currentTemplate?'核对数据列与顺序后，预检背景。':'先选择拟合模板，再添加本批次数据。'}}</p>
    <p v-if="metadataMessage" role="status">{{metadataMessage}}</p>

    <p v-if="busy" role="status">{{busyMessage||'正在检查模板…'}}</p><p v-if="error" role="alert" class="error">{{error}}</p>
  </div>
  <section :id="panelId('import')" role="tabpanel" :aria-labelledby="`batch-tab-import-${analysisMode}`" v-show="activeView==='import'" class="setup-stage">
    <div ref="importSection" data-test="batch-settings" class="setup-root">
      <div class="setup-workspace">
        <div class="setup-grid" :class="{'is-config-open':configOpen}" >
          <fieldset :disabled="busy||locked" class="setup-data panel" aria-label="数据清单" data-test="batch-dropzone" @dragover.prevent="dragging=!busy&&!locked&&!!currentTemplate" @dragleave.self="dragging=false" @drop.prevent="dropFiles" :class="{'is-dragging':dragging}">
            <header class="setup-data-header">
              <div><h3>数据清单</h3><p class="hint" data-test="batch-import-summary">{{fileCount}} 个文件 · {{sheetCount}} 个工作表 · {{inputs.length}} 条谱线已导入 · {{included.length}} 条谱线参与拟合</p></div>
              <button v-if="inputs.length&&!locked" :disabled="!currentTemplate||busy" @click="fileInput?.click()" data-test="batch-add-files">+ 添加文件</button>
            </header>
            <input ref="fileInput" type="file" multiple accept=".csv,.txt,.tsv,.dat,.xy,.xye,.xls,.xlsx,.xlsm" hidden @change="upload" />
            <p v-if="importMessage" class="setup-message hint" role="status">{{importMessage}}</p>
            <BatchImportSelector v-if="drafts.length" :drafts="drafts" :existing="included" :disabled="busy||locked" @commit="commitSelection" @cancel="drafts=[];importMessage='已取消本次导入，原批次保持不变。'" />
            <div v-if="!inputs.length&&!locked" class="setup-empty" :class="{'is-dragging':dragging}">
              <svg aria-hidden="true" viewBox="0 0 48 48" fill="none"><path d="M24 30V8m-8 8 8-8 8 8M9 29v10h30V29" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
              <h3>拖入数据文件，开始配置批次</h3>
              <p>CSV / TXT / Excel 等 · 支持多文件、多工作表与多 Y 列</p>
              <button class="primary" :disabled="!currentTemplate||busy" @click="fileInput?.click()">选择数据文件</button>
              <p class="hint">{{currentTemplate?'选择 X / Y → 纳入谱线 → 核对顺序与批次配置':'请先在右侧建立或加载拟合模板，再添加文件。'}}</p>
            </div>
            <template v-if="inputs.length">
            <div v-if="!locked" class="batch-order-controls"><label>执行顺序<select v-model="order" @change="orderOpen=false"><option value="original">原始纳入顺序</option><option value="file">文件名自然顺序</option><option value="column">谱列名自然顺序</option><option value="condition" :disabled="!orderCondition.available">实验条件数值顺序</option></select></label><button @click="orderOpen=!orderOpen">预览排序</button></div>
            <div v-if="orderOpen&&!locked" class="batch-order-preview"><p class="hint">仅预览；应用后需要重新预检背景。</p><ol><li v-for="row in ordered" :key="row.id">{{row.dataset.filename}} / {{row.sheet}} / {{row.yColumn}}{{row.included?'':'（未纳入）'}}</li></ol><div class="batch-inline-actions"><button :disabled="order==='condition'&&!orderCondition.available" @click="applyOrder">应用此顺序</button><button @click="orderOpen=false">取消排序</button></div></div>

              <div class="batch-table-scroll batch-input-table" tabindex="0" aria-label="导入谱线列映射与顺序">
                <table><colgroup><col class="setup-col-include"/><col class="setup-col-order"/><col class="setup-col-source"/><col class="setup-col-mapping"/><col class="setup-col-mapping"/><col class="setup-col-status"/><col class="setup-col-move"/></colgroup>
                  <thead><tr><th scope="col">纳入</th><th scope="col">顺序</th><th scope="col">文件 / 工作表</th><th scope="col">X 列</th><th scope="col">Y 列</th><th scope="col">映射 / 校验</th><th scope="col">调整</th></tr></thead>
                  <tbody><tr v-for="(row,i) in inputs" :key="row.id" :class="{'is-excluded':!row.included}">
                    <td><input v-model="row.included" type="checkbox" :aria-label="`纳入 ${i+1}`" @change="invalidate" /></td>
                    <td class="setup-sequence">{{row.included?included.indexOf(row)+1:'—'}}</td>
                    <th scope="row"><span class="setup-filename" :title="row.dataset.filename">{{row.dataset.filename}}</span><small class="setup-filename" :title="`${row.sheet} / ${row.yColumn}`">{{row.sheet}} / {{row.yColumn}}</small></th>
                    <td><select v-model="row.xColumn" :title="row.xColumn" :aria-label="`第 ${i+1} 条 X 列`" @change="invalidate"><option v-for="col in row.columns" :key="col">{{col}}</option></select></td>
                    <td><select v-model="row.yColumn" :title="row.yColumn" :aria-label="`第 ${i+1} 条 Y 列`" @change="invalidate"><option v-for="col in row.columns" :key="col">{{col}}</option></select></td>
                    <td><span class="setup-mapping-state" :class="{'has-error':row.error||row.xColumn===row.yColumn}" :title="row.error||mappingStatus(row)">{{row.included?mappingStatus(row):'不参与拟合'}}</span></td>
                    <td class="setup-move"><button :disabled="i===0" @click="move(i,-1)" :aria-label="`上移 ${i+1}`">↑</button><button :disabled="i===inputs.length-1" @click="move(i,1)" :aria-label="`下移 ${i+1}`">↓</button></td>
                  </tr></tbody>
                </table>
              </div>
              <p class="hint setup-list-note">自上而下执行 · 直接编辑 X / Y 列 · 取消纳入保留原始数据 · 可拖入文件继续添加</p>
            </template>
          </fieldset>
          <aside ref="configPanel" tabindex="-1" class="setup-config panel" aria-label="批次配置" @keydown.esc="configOpen&&toggleConfig(false)">
            <header class="setup-config-header"><h3>批次配置</h3><button class="setup-config-toggle" @click="toggleConfig(false)">收起配置</button><span class="hint">{{locked?'当前批次只读':canPrepare?'可开始预检':'请核对配置'}}</span></header>
            <div class="setup-config-scroll">
      <div class="batch-template-card">
        <div><strong>{{currentTemplate?'✓ 拟合模板已就绪':'选择拟合模板'}}</strong><p class="hint">{{currentTemplate?`${analysisName} · ${currentTemplate.components.filter(c=>c.enabled).length} 个启用峰`:'使用单谱工作区的配置，或加载同类型模板 JSON。'}}</p></div>
        <div class="xps-actions"><button :disabled="busy||active" @click="emit('single')" data-test="batch-from-single">{{currentTemplate?'返回单谱工作区':'从单谱建立模板'}}</button><button :disabled="busy||locked" @click="templateInput?.click()">{{currentTemplate?'更换模板 JSON':'加载模板 JSON'}}</button><input ref="templateInput" type="file" accept=".json,application/json" hidden data-test="batch-template-file" @change="loadTemplate" /></div>
      </div>

              <fieldset v-if="currentTemplate" :disabled="busy||locked" class="setup-config-fields">
                <dl class="setup-range"><div><dt>X 单位</dt><dd>{{analysisMode==='general'?'原始数据单位（人工核对）':unit}}</dd></div><div><dt>拟合区间</dt><dd>{{formatNumber(currentTemplate.range_start)}} — {{formatNumber(currentTemplate.range_end)}}</dd></div></dl>
          <p v-if="missingBackgroundWindows" class="warning" role="status" data-test="batch-background-window-hint">逐谱背景需要两端窗口。当前模板仅含手动水平时，请返回单谱设置端点窗口后重新用于批量拟合；仅当所有谱线背景相同时，才选择固定绝对背景。</p>
          <div class="batch-import-options">
            <div><label class="batch-strategy">批量策略<select v-model="sequential" data-test="batch-strategy"><option :value="false">独立拟合</option><option :value="true">顺序拟合</option></select></label><p class="hint">{{sequential?'后续谱线继承上一条获准结果作为初值，适用于相关连续序列；可用独立拟合作为对照，请核对实验顺序。':'每条谱线使用同一模板初值。'}}</p></div>
            <div>
              <div class="confirmation-callout" :class="{'is-confirmed':unitsConfirmed}">
                <strong class="confirmation-status">{{unitsConfirmed?'✓ 已确认':'! 预检前请勾选确认'}}</strong>
                <label class="xps-check"><input v-model="unitsConfirmed" type="checkbox" data-test="batch-units" :aria-describedby="`batch-units-hint-${analysisMode}`" />已核对本批次 X 单位、区间{{analysisMode==='xps'?'及 XPS 校准设置':''}}一致</label>
                <p :id="`batch-units-hint-${analysisMode}`" class="confirmation-hint">{{unitsConfirmed?'单位与区间已核对。':'核对所有谱线后勾选，才能进入背景预检。'}}</p>
              </div>
              <div :class="explicitAnchors?['confirmation-callout',{'is-confirmed':fixedBaseline}]:undefined">
                <strong v-if="explicitAnchors" class="confirmation-status">{{fixedBaseline?'✓ 已确认使用固定背景':'! 当前模板需要确认背景适用性'}}</strong>
                <label class="xps-check"><input v-model="fixedBaseline" type="checkbox" :aria-describedby="explicitAnchors?`batch-fixed-hint-${analysisMode}`:undefined" />固定绝对背景（仅用于各谱背景相同的情况）</label>
                <p v-if="explicitAnchors" :id="`batch-fixed-hint-${analysisMode}`" class="confirmation-hint">模板含显式锚点：请确认所有谱线背景相同后勾选；背景不同请返回单谱工作区调整模板。</p>
              </div>
            </div>
          </div>

                <BatchMetadataEditor :rows="metadataRows" :metadata="metadata" :disabled="busy||locked" @change="orderOpen=false" />
                <p v-if="included.length" class="hint">实验记录随批次追溯 JSON 导出；CSV 不包含这些记录。</p>
              </fieldset>
            </div>
          </aside>
        </div>
        <footer class="setup-footer panel" data-test="batch-import-footer">
          <div class="setup-footer-status"><strong>{{fileCount}} 个文件 · {{included.length}} 条参与拟合 <span class="hint">映射 {{mappedCount}} / {{included.length}} · {{unitsConfirmed?'已人工核对':'待人工核对'}}</span></strong><p class="hint" data-test="batch-prepare-hint" role="status">{{!currentTemplate?'请先建立或加载拟合模板。':locked?'当前批次配置已锁定，可切换到背景复核或结果阶段。':prepareHint}}</p><small>上限 100 条 / 200,000 点 · 完成有效预检后可保存本地会话；刷新不会自动保存</small></div>
          <button ref="configTrigger" class="setup-config-toggle" :aria-expanded="configOpen" @click="toggleConfig(!configOpen)">{{configOpen?'收起配置':'批次配置'}}</button>
          <button v-if="!locked" class="primary" :disabled="!canPrepare" :title="!canPrepare?prepareHint:undefined" @click="prepare" data-test="batch-prepare">预检并进入背景复核</button>
          <button v-else @click="showReview">查看背景复核</button>
        </footer>
      </div>
    </div>
  </section>

  <section :id="panelId('review')" role="tabpanel" :aria-labelledby="`batch-tab-${activeView==='review'?'review':'results'}-${analysisMode}`" v-show="activeView==='review'||activeView==='results'" :class="{'review-stage':reviewLayout}" data-test="batch-review-stage" @keydown="navigateReview">
    <div v-if="activeView==='review'&&preflightFinished&&(!run||restoredReview)" class="batch-handoff" data-test="batch-next-step" role="status">
      <div><strong>{{nextStepText}}</strong><p class="hint">预检通过 {{reviewable.length}} 条 · 失败 {{failedInputs.length}} 条 · 已复核 {{reviewable.length-unconfirmed.length}} 条</p></div>
      <div class="xps-actions"><button @click="openImport" data-test="batch-edit-inputs">返回修改数据</button><button v-if="settingsOpen" @click="showReview">返回背景复核</button></div>
    </div>
    <div v-if="reviewLayout" class="review-view-toolbar">
      <div class="review-view-switch"><strong>{{overviewOpen?'批量总览':'单谱背景复核'}}</strong><span class="hint">{{reviewable.length-unconfirmed.length}} / {{included.length}} 已复核</span><progress :value="reviewable.length-unconfirmed.length" :max="included.length" aria-label="背景复核进度" /></div>
      <div class="xps-actions"><button v-if="reviewUndo.length&&(!locked||restoredReview)" :disabled="busy" @click="undoReview" data-test="batch-undo-review">撤销本次批量复核</button><button ref="bulkTrigger" class="review-bulk-trigger" :aria-expanded="bulkReviewOpen" :aria-controls="`batch-bulk-panel-${analysisMode}`" :disabled="reviewLocked||!unconfirmed.length" :title="reviewLocked?'当前批次已锁定或正在处理':!unconfirmed.length?'没有有效待复核谱线':'选择多条谱线，或确认整批待复核背景'" @click="bulkReviewOpen=!bulkReviewOpen" data-test="batch-bulk-toggle">{{bulkReviewLabel}}</button><button ref="overviewTrigger" :aria-pressed="overviewOpen" @click="overviewOpen=!overviewOpen" data-test="batch-open-overview">{{overviewOpen?'返回单谱复核':'批量总览'}}</button><button v-if="!overviewOpen&&!bulkReviewOpen" :aria-expanded="thumbnailsOpen" @click="thumbnailsOpen=!thumbnailsOpen" data-test="batch-toggle-thumbnails" class="review-thumbnail-toggle">{{thumbnailsOpen?'收起缩略图':'展开缩略图'}}</button><button v-if="!overviewOpen" class="review-panel-toggle" :aria-expanded="reviewPanelOpen" @click="reviewPanelOpen=!reviewPanelOpen">背景设置与复核</button></div>
    </div>
  <section v-if="reviewLayout" v-show="bulkReviewOpen" :id="`batch-bulk-panel-${analysisMode}`" class="review-bulk-panel" aria-label="批量背景复核操作" @keydown.esc.stop="closeBulkReview">
    <div class="review-bulk-scope" data-test="batch-bulk-scope"><strong>已选 {{selectedForReview.length}} 条<span v-if="hiddenReviewSelection"> · {{hiddenReviewSelection}} 条在筛选之外</span></strong><p>请先检查背景适用性。全部复核作用于整批 {{unconfirmed.length}} 条有效待复核谱线，包含筛选隐藏项。</p></div>
    <div class="review-bulk-buttons"><button v-if="overviewOpen" @click="overviewOpen=false">返回列表选择谱线</button><button class="primary" :disabled="reviewLocked||!selectedForReview.length" @click="applyBulkReview(selectedForReview)" data-test="batch-confirm-selected">确认所选 {{selectedForReview.length}} 条背景</button><button :disabled="reviewLocked||!unconfirmed.length" @click="confirmAll" data-test="batch-confirm-all">确认全部待复核（{{unconfirmed.length}} 条）</button><button @click="closeBulkReview" aria-label="收起批量复核操作">收起</button></div>
  </section>
  <BatchBackgroundOverview :id="`batch-background-${analysisMode}`" tabindex="-1" v-if="activeView==='review'&&preflightFinished" v-show="overviewOpen" data-test="batch-overview-view" :rows="overviewRows" :selected="selected" :unit="unit" :reversed="analysisMode==='xps'" @select="locateSpectrum" />
  <div v-if="included.length&&(preflightFinished||run)" v-show="!reviewLayout||!overviewOpen" class="batch-results-layout" :id="`batch-spectra-${analysisMode}`" tabindex="-1" data-test="batch-results">
    <aside class="panel batch-sidebar" aria-label="谱线列表">
      <div class="batch-sidebar-heading"><h3>谱线队列</h3><span class="hint">{{visibleRows.length}} / {{included.length}}</span></div>
      <label>搜索谱线<input v-model="search" type="search" placeholder="文件、工作表或 Y 列" data-test="batch-search" /></label>
      <label>状态筛选<select v-model="statusFilter" data-test="batch-filter"><option value="all">全部</option><option value="review">{{activeView==='review'?'背景待复核':'待复核'}}</option><option value="failed">{{activeView==='review'?'预检失败':'失败'}}</option><option v-if="activeView==='review'" value="ready">背景已复核</option><option v-else-if="run" value="success">已完成计算</option><option value="pending">{{activeView==='review'?'待预检':'待执行'}}</option></select></label>
      <div v-if="reviewLayout&&bulkReviewOpen" class="review-bulk-selection"><button :disabled="reviewLocked||!visibleForReview.length" @click="selectVisibleForReview" data-test="batch-select-visible">全选当前筛选结果（{{visibleForReview.length}}）</button><button :disabled="!selectedForReview.length" @click="bulkSelection.clear()">清空选择</button></div>
      <div ref="queue" class="batch-list" @keydown="navigateList">
        <div v-for="item in visibleRows" :key="item.row.id" v-memo="[bulkReviewOpen,bulkSelection.has(item.row.id),item.row.id,selected===item.index,item.index,item.status,item.row.confirmed,item.row.preview,item.row.error,busy,locked,restoredReview,activeView,run?.rows[item.index]?.result,run?.rows[item.index]?.accepted_attempt_id]" class="batch-row" :class="{'batch-selected':selected===item.index,'is-bulk-selecting':reviewLayout&&bulkReviewOpen}" :data-row-index="item.index" data-test="batch-row">
          <label v-if="reviewLayout&&bulkReviewOpen" class="review-bulk-checkbox" :title="item.row.error?'预检失败，不能复核':item.row.confirmed?'已复核':!item.row.preview?'请先预检':'选择此谱线进行批量复核'"><input type="checkbox" :checked="bulkSelection.has(item.row.id)" :disabled="reviewLocked||item.status!=='review'||!item.row.request" :aria-label="`选择批量复核谱线 ${item.index+1}`" @change="chooseForReview(item.row,$event)" /></label>
          <button class="batch-row-select" :title="`${item.row.dataset.filename} / ${item.row.sheet} / ${item.row.yColumn}`" :data-test="`batch-view-${item.index+1}`" :aria-pressed="selected===item.index" @click="selectRow(item.index)">
            <span class="batch-row-name">{{item.index+1}} · {{item.row.yColumn}}</span>
            <span class="batch-row-column">{{item.row.dataset.filename}} / {{item.row.sheet}}</span>
            <span class="batch-row-meta"><span class="batch-state" :class="`state-${item.status}`">{{item.status==='success'?'✓ ':item.status==='review'?'⚠ ':item.status==='failed'?'! ':item.status==='running'?'◌ ':''}}{{run&&activeView!=='review'?statusLabels[item.status]:item.status==='review'?'背景待复核':item.status==='failed'?'预检失败':item.status==='ready'?'✓ 背景已复核':'待预检'}}</span><span v-if="activeView==='results'">RMSE {{formatNumber(run?.rows[item.index]?.result?.statistics.rmse)}}</span><span v-if="activeView==='results'&&run?.rows[item.index]?.attempts.some(a=>a.id===run?.rows[item.index]?.accepted_attempt_id&&a.manually_accepted)">人工接受 · 警告保留</span></span>
          </button>
          <div v-show="activeView==='review'" class="confirmation-callout confirmation-compact" :class="{'is-confirmed':item.row.confirmed,'is-unavailable':!item.row.preview||Boolean(item.row.error)}">
            <label class="batch-row-review"><input type="checkbox" :checked="item.row.confirmed" :disabled="locked&&!restoredReview||busy||!item.row.preview||Boolean(item.row.error)" :aria-label="`复核背景 ${item.index+1}`" @change="confirm(item.row,$event)" />{{item.row.confirmed?'✓ 背景已复核':item.row.error?'预检失败，暂不可复核':!item.row.preview?'请先预检背景':'! 请勾选确认背景'}}</label>
          </div>
        </div>
        <p v-if="!visibleRows.length" class="hint">没有符合筛选条件的谱线。<button @click="search='';statusFilter='all'">清除筛选</button></p>
      </div>
    </aside>

    <section class="batch-detail" v-if="selectedInput" aria-label="当前谱线结果">
      <section ref="detailHeading" tabindex="-1" class="panel batch-detail-heading">
        <div class="batch-toolbar"><h3 data-test="batch-detail-title">{{selected+1}} · {{selectedInput.dataset.filename}} / {{selectedInput.yColumn}}<small class="batch-sheet">工作表：{{selectedInput.sheet}}</small></h3><span>{{selected+1}} / {{included.length}}</span></div>
        <div class="xps-actions"><button :disabled="previousIndex===undefined" @click="selectRow(previousIndex)" data-test="batch-previous">上一条</button><button :disabled="nextIndex===undefined" @click="selectRow(nextIndex)" data-test="batch-next">下一条</button><button :disabled="nextReviewIndex===undefined" @click="search='';statusFilter='all';selectRow(nextReviewIndex)">下一个待复核</button>
          <button v-if="run&&activeView==='results'" @click="trendPeak=selectedPeak||trendPeak;changeView('trend')">查看峰参数趋势</button>
        </div>
        <p v-if="!visibleRows.some(item=>item.index===selected)" class="hint">当前查看的谱线不在筛选结果中。</p>
        <div v-if="activeView==='results'&&(selectedWarnings.length||selectedRun?.status==='review'||selectedRun?.status==='failed')" class="batch-warning" data-test="batch-warning" role="status">
          <strong>{{selectedRun?.status==='review'?'⚠ 拟合结果待复核':selectedRun?.status==='failed'?'! 本谱拟合失败':'提示'}}</strong>
          <ul><li v-for="message in selectedWarnings" :key="message">{{message}}</li></ul>
        </div>
        <p v-if="selectedRun?.status==='running'" role="status">正在计算此谱线…</p>
        <p v-else-if="!shownResult&&run&&activeView==='results'" class="hint">{{selectedRun?.status==='failed'?'本谱未获得可用结果。':selectedRun?.status==='skipped'?'本谱已跳过。':'尚未拟合。'}}{{shownPreview?'下方显示原谱与背景预览。':'请在批次设置中预检谱线。'}}</p>
        <p v-else-if="shownResult" class="batch-metrics">计算：{{diagnosis.calculation}} · 诊断：{{diagnosis.diagnostic}} · 人工状态：{{diagnosis.review}} · RMSE <strong>{{formatNumber(shownResult.statistics.rmse)}}</strong> · {{shownResult.converged?'已收敛':'未收敛结果'}} · {{selectedRun?.attempts.length??0}} 次尝试 · 初值来源：{{sourceLabels[latestAttempt?.initialization_source??'template']}}</p>
        <div v-if="activeView==='results'&&run&&!active&&!restoredReview&&['review','failed'].includes(selectedRun?.status??'')" class="xps-actions">
          <button :disabled="selectedRun?.status!=='review'||!latestAttempt?.result?.converged" @click="run.accept(selected)">接受当前结果</button><button @click="run.skip(selected)">标记跳过</button><button @click="detailTab='configuration';resultViews?.showArchive()">调整初值</button>
        </div>
      </section>
      <DatasetAuditSummary v-if="selectedInput&&activeView!=='review'" :audit="audits[selectedInput.id]" />
    <BatchResultChart v-if="(activeView==='review'||activeView==='results')&&shownRequest&&shownPreview" :key="selectedInput.id+activeView" :fill="reviewLayout||activeView==='results'" :request="shownRequest" :preview="shownPreview" :result="shownResult" :selected-peak="selectedPeak" />
      <div v-else-if="reviewLayout" class="panel review-empty" role="status"><h3>{{selectedInput.error?'当前谱线预检失败':'等待背景预览'}}</h3><p>{{selectedInput.error||'请先重新预览恢复背景，再检查曲线。'}}</p><button @click="openImport">查看数据与配置</button></div>
      <ResultWorkspace ref="resultViews" archive-label="记录与配置" class="batch-detail-tabs" v-if="shownRequest&&run" v-show="activeView==='results'">
        <template #tools><button class="batch-result-resize" :aria-expanded="resultsExpanded" @click="resultsExpanded=!resultsExpanded" data-test="batch-expand-results">{{resultsExpanded?'收起结果面板':'展开结果面板'}}</button></template>
        <div>
          <template v-if="shownResult">
            <MultiPeakResults :y-unit="units.y" hide-actions v-if="isMulti(shownRequest)" :result="shownResult as MultiResult" :accepted="latestAttempt?.manually_accepted" :selected-peak="selectedPeak" @select="selectedPeak=$event" :stale="false" :busy="selectedRun?.status==='running'" :unit="unit" /><XpsResults :y-unit="units.y" hide-actions v-else :result="shownResult as XpsResult" :accepted="latestAttempt?.manually_accepted" :selected-peak="selectedPeak" @select="selectedPeak=$event" :stale="false" :busy="selectedRun?.status==='running'" />
          </template>
          <p v-else class="hint">尚无拟合参数，完成拟合后显示。</p>
        </div>
        <template #archive><div class="analysis-archive"><div class="batch-tabs" aria-label="归档详情"><button :aria-pressed="detailTab!=='configuration'" @click="detailTab='attempts'">尝试记录</button><button :aria-pressed="detailTab==='configuration'" @click="detailTab='configuration'">拟合配置</button></div><div v-show="detailTab!=='configuration'"><h3>当前谱尝试记录</h3><p v-if="!selectedRun?.attempts.length" class="hint">此谱线尚无拟合尝试。</p><ol><li v-for="a in selectedRun?.attempts??[]" :key="a.id">{{sourceLabels[a.initialization_source]}} · {{a.invalidated?'已失效':a.result?.converged?'已收敛':'未成功'}} · {{a.error}} {{a.warnings.join('；')}} {{a.manually_accepted?'（人工接受）':''}}</li></ol></div>
        <div v-show="detailTab==='configuration'">
          <p class="hint">分析区间：{{formatNumber(shownRequest.range_start)}} — {{formatNumber(shownRequest.range_end)}} {{unit}} · 最大函数评估次数 {{shownRequest.solver.max_nfev}}</p>
          <details v-if="editRequest&&!active&&run"><summary>调整本谱初值并从此重跑</summary><p class="hint">重跑后本谱及下游旧结果标为失效，历史尝试仍保留。</p>
            <div v-for="c in editRequest.components" :key="c.id"><h4>{{c.id}} · {{c.label}}</h4><div class="batch-parameters"><label v-for="(p,name) in c.parameters" :key="name">{{name}}{{p?.fixed?'（固定）':''}}<input v-if="p" v-model.number="p.value" type="number" step="any" :disabled="p.fixed||editRequest.constraints.some(link=>link.target.component===c.id&&link.target.parameter===name)" /></label></div></div>
            <label>最大函数评估次数<input v-model.number="editRequest.solver.max_nfev" type="number" min="1" max="20000" /></label><button @click="rewind">应用初值，重置本谱及后续结果</button>
          </details>
          <p v-else class="hint">{{active?'运行结束或暂停后可调整本谱初值。':'开始批量拟合后可在此调整本谱初值。'}}</p>
        </div>
      </div></template></ResultWorkspace>
    </section>
    <aside v-if="reviewLayout&&selectedInput" class="panel review-inspector" :class="{'is-open':reviewPanelOpen}" aria-label="背景复核面板" @keydown.esc="reviewPanelOpen=false">
      <div class="review-inspector-heading"><h3>背景复核</h3><button class="review-panel-toggle" @click="reviewPanelOpen=false">收起</button><span class="review-badge" :class="{'is-confirmed':selectedInput.confirmed}">{{selectedInput.error?'预检失败':selectedInput.confirmed?'已复核':'待复核'}}</span></div>
      <div class="review-inspector-body">
        <BatchBackgroundSettings :request="shownRequest" :preview="selectedInput.preview" :unit="unit" />
        <div class="review-config-actions"><button @click="openImport" :disabled="busy||active">查看批次配置</button><p class="hint">背景由模板统一设置。修改模板或数据后，沿用整批重新预检与复核流程。</p></div>
        <section class="review-quality"><h4>数据质量</h4><p v-if="selectedInput.error" class="error">{{selectedInput.error}}</p><p v-else-if="selectedInput.preview" class="hint">预检有效 · {{shownRequest?.x.length}} 个原始数据点</p><DatasetAuditSummary :audit="audits[selectedInput.id]" /></section>
        <p class="hint">预检仅检查输入与数值条件；背景适用性仍需人工判断。</p>
      </div>
      <div class="review-inspector-footer">
        <p class="review-current-status">{{selectedInput.confirmed?'✓ 本谱背景已复核':selectedInput.error?'请先解决预检错误':'检查原谱与背景曲线后确认'}}</p>
        <button class="primary" :disabled="busy||locked&&!restoredReview||!selectedInput.preview||!!selectedInput.error" @click="confirmAndNext" data-test="batch-confirm-next">{{selectedInput.confirmed?'保持复核并下一条':'确认复核并下一条'}}</button>
        <button v-if="selectedInput.confirmed" :disabled="busy||locked&&!restoredReview" @click="setReview(selectedInput,false)" data-test="batch-revoke-current">撤销本谱复核</button>
        <button v-else :disabled="busy||locked&&!restoredReview||!selectedInput.preview||!!selectedInput.error" @click="setReview(selectedInput,true)" data-test="batch-confirm-current">仅确认本谱</button>
      </div>
    </aside>
  </div>
  <div v-if="reviewLayout" class="review-bottom">
    <p v-if="reviewMessage" class="review-feedback" role="status" data-test="batch-review-message">{{reviewMessage}}</p>
    <div v-if="!overviewOpen&&selectedInput" class="review-compact-actions"><span>{{selectedInput.confirmed?'本谱已复核':'本谱待复核'}}</span><button @click="reviewPanelOpen=!reviewPanelOpen">背景设置</button><button class="primary" :disabled="busy||locked&&!restoredReview||!selectedInput.preview||!!selectedInput.error" @click="confirmAndNext">确认并下一条</button></div>
    <BatchBackgroundOverview v-if="!overviewOpen&&!bulkReviewOpen&&thumbnailsOpen&&preflightFinished" compact class="review-thumbnails" :rows="overviewRows" :selected="selected" :unit="unit" :reversed="analysisMode==='xps'" @select="locateSpectrum" />
  </div>
  </section>
  <section :id="panelId('trend')" role="tabpanel" :aria-labelledby="`batch-tab-trend-${analysisMode}`" v-show="activeView==='trend'">
    <BatchTrendChart v-if="run&&activeView==='trend'" v-model:peak="trendPeak" v-model:metric="trendMetric" v-model:axis="trendAxis" :rows="run.rows" :metadata="metadata" :unit="unit" @select="locateTrend" />
  </section>
  <section :id="panelId('export')" role="tabpanel" :aria-labelledby="`batch-tab-export-${analysisMode}`" v-show="activeView==='export'">
    <template v-if="run">
      <BatchExportPanel :key="run.id" :selected-label="`${selected+1} · ${selectedRun?.label??''}`" :count="run.rows.length" :calculated="counts.calculated" :running="active" :trend-label="trendLabel" :has-peak="trendPeaks.has(trendPeak)" :statuses="run.rows.map(row=>row.status)" :selected-status="selectedRun?.status" :message="exportMessage" :error="exportError" @inspect="inspectExportStatus" @clear-feedback="clearExportFeedback" @fit="downloadFit" @trend="downloadTrend" @show-trend="changeView('trend')" />
      <section class="analysis-archive"><div class="archive-heading"><h2>分析摘要</h2><span>记录分析依据与人工复核状态</span></div><AnalysisReportActions :entries="reportEntries" :disabled="busy||active" /></section>
    </template>
  </section>
</section>
</template>
<style scoped>
.batch-workbench{display:grid;grid-template-columns:minmax(0,1fr);gap:16px;margin-top:20px}
.batch-workbench>[role=tabpanel]{min-width:0}
.batch-header{padding:12px 16px}.batch-header .batch-toolbar>div:first-child{display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.batch-header .batch-toolbar p{margin:0}
.batch-toolbar,.batch-sidebar-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.batch-toolbar h3,.batch-sidebar h3{margin:0}.batch-toolbar .xps-actions{margin:0}
.batch-progress{padding:10px 0;border-top:1px solid var(--ui-border);font-variant-numeric:tabular-nums}
.batch-settings{border-top:1px solid var(--ui-border);margin-top:12px}
.batch-flow{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin:14px 0}
.batch-flow button{flex:1;display:flex;align-items:center;gap:8px;min-width:0;height:auto;padding:10px;text-align:left;white-space:normal;background:var(--ui-subtle)}
.batch-flow button[aria-current=step]{border-color:var(--ui-text);background:var(--ui-selected);font-weight:600}
.batch-flow button>span:first-child{width:22px;height:22px;display:grid;place-items:center;border:1px solid currentColor;border-radius:50%;flex:none}
.batch-flow .batch-flow-label{display:block;min-width:0}.batch-flow small{display:block;margin-top:4px;font-weight:400;color:var(--ui-text-muted)}
.batch-template-card,.batch-dropzone,.batch-import-summary,.batch-import-footer,.batch-handoff,.batch-current-review{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.batch-template-card{padding:12px 0;border-bottom:1px solid var(--ui-border)}.batch-template-card .xps-actions{margin:0}
.batch-import-fields{border:0;padding:0;margin:12px 0;min-width:0}
.batch-dropzone{padding:16px;border:1px dashed var(--ui-border-strong);border-radius:6px;background:var(--ui-subtle);margin-bottom:12px}
.batch-dropzone.is-dragging{border-color:var(--ui-primary);background:var(--ui-selected)}
.batch-import-summary{margin:12px 0 4px}.batch-input-table{max-height:280px;overflow:auto;border:1px solid var(--ui-border);border-radius:4px}
.batch-input-table th{position:sticky;top:0;z-index:1;background:var(--ui-subtle)}
.batch-import-options{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:24px;margin-top:12px}
.batch-import-footer{border-top:1px solid var(--ui-border);padding-top:12px;margin-top:12px}
.batch-import-footer>div{flex:1;min-width:200px}.batch-import-footer p{margin-bottom:0}
.batch-handoff{padding:12px;border-left:3px solid var(--ui-primary);background:var(--ui-subtle);margin-top:12px}.batch-handoff p{margin-bottom:0}
.batch-current-review{margin-top:10px;font-size:13px}
@media(max-width:700px){.batch-import-options{grid-template-columns:minmax(0,1fr);gap:4px}.batch-flow{gap:8px;grid-template-columns:repeat(2,minmax(0,1fr))}.batch-flow button:last-child{grid-column:1/-1}.batch-flow button{min-width:0;flex-direction:column;align-items:flex-start;font-size:12px;padding:8px}.batch-flow small{margin:0}.batch-dropzone{align-items:flex-start}.batch-import-footer>button{width:100%}}
.batch-strategy{display:flex;align-items:center;gap:12px;max-width:300px}.batch-strategy select{width:180px}
.batch-results-layout{display:grid;grid-template-columns:300px minmax(0,1fr);gap:16px;align-items:start}
.batch-sidebar{position:sticky;top:16px;max-height:calc(100dvh - 32px);display:flex;flex-direction:column}
.batch-sidebar label{margin:8px 0}.batch-review-tools{padding:8px 0 12px;border-bottom:1px solid var(--ui-border)}
.batch-review-tools>button{width:100%;white-space:normal;height:auto;min-height:36px;padding:6px}
.batch-review-tools p{font-size:12px}.batch-list{overflow-y:auto;min-height:120px;margin-top:8px;scrollbar-gutter:stable}
.batch-row{border:1px solid transparent;border-bottom-color:var(--ui-border);padding:4px;border-radius:4px}
.batch-selected{background:var(--ui-selected,#edf5f7);border-color:var(--ui-border-strong)}
.batch-row-select{display:block;width:100%;height:auto;text-align:left;white-space:normal;padding:8px;border:0;background:transparent}
.batch-row-select>span{display:block}.batch-row-name{font-weight:600;overflow-wrap:anywhere}
.batch-row-column{color:var(--ui-text-muted);font-size:12px;overflow-wrap:anywhere;margin:4px 0}
.batch-row-select .batch-row-meta{display:flex;justify-content:space-between;gap:6px;flex-wrap:wrap;font-size:12px}
.batch-state{font-weight:600}.state-success{color:#25643c}.state-review{color:#885000}.state-failed{color:#ab2626}.state-running{color:#136596}
.batch-row .batch-row-review{display:flex;align-items:center;gap:10px;font-size:12px;margin:0;color:inherit}
.batch-detail{display:grid;gap:12px;min-width:0}.batch-detail-heading{padding:12px 16px}.batch-detail-heading h3{overflow-wrap:anywhere;min-width:0;flex:1}
.batch-warning{background:#fff8e8;border-left:3px solid #b17819;padding:10px 12px;margin:10px 0;overflow-wrap:anywhere}.batch-warning ul{margin:4px 0;padding-left:20px}
.batch-metrics{font-size:13px;font-variant-numeric:tabular-nums}
.batch-tabs{display:flex;gap:8px;border-bottom:1px solid var(--ui-border);padding-bottom:10px;margin-bottom:12px;flex-wrap:wrap}
.batch-tabs button[aria-pressed=true]{background:var(--ui-primary);color:var(--ui-on-primary)}
.batch-menu{position:relative}.batch-menu summary{padding:7px 10px;border:1px solid var(--ui-border);border-radius:4px;font-weight:500}
.batch-menu-content{position:absolute;right:0;top:100%;z-index:30;background:var(--ui-surface);border:1px solid var(--ui-border);padding:10px;display:grid;gap:6px;min-width:210px;max-width:calc(100vw - 48px);box-shadow:0 6px 20px #0002}
.batch-menu-content button{white-space:normal;height:auto;min-height:36px}
.batch-table-scroll{overflow-x:auto}.batch-table-scroll table{min-width:740px;width:100%}.batch-table-scroll .batch-peak-table{min-width:500px}
.batch-table-scroll select{max-width:180px}.batch-parameters{display:flex;gap:12px;flex-wrap:wrap}.batch-parameters label{width:140px}
fieldset{border:1px solid var(--ui-border);border-radius:6px;padding:14px;min-width:0}legend{font-weight:600}
@media(max-width:900px){.batch-results-layout{grid-template-columns:minmax(0,1fr)}.batch-sidebar{position:static;max-height:none}.batch-list{max-height:260px}.batch-menu-content{right:auto;left:0}}
@media(max-width:480px){.batch-toolbar{align-items:flex-start}.batch-toolbar .xps-actions{width:100%}.batch-detail-heading h3{flex-basis:100%}.batch-row-select{min-height:70px}}
</style>

<style scoped src="../styles/batchWorkbenchPresentation.css"></style>
