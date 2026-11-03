<script setup lang="ts">
import { spectrumUnits } from "../spectrumUnits";
import WorkbenchLayoutTools from './WorkbenchLayoutTools.vue';
import WorkbenchMenu from './WorkbenchMenu.vue';
import WorkbenchSplitHandle from './WorkbenchSplitHandle.vue';
import {useWorkbenchLayout} from '../useWorkbenchLayout';
import WorkbenchViewNav from "./WorkbenchViewNav.vue";
import { usePeakRemovalUndo } from "../usePeakRemovalUndo";
import ResultWorkspace from "./ResultWorkspace.vue";
import { confirmDiscard, useWorkProtection } from '../useWorkProtection';
import { computed, nextTick, ref, watch } from "vue";
import { candidatesXps, fitXps, previewXps } from "../xpsApi";
import { exportXpsResult } from "../xpsResultExport";
import { removeComponent, addComponent, createConfig, loadConfiguration, RevisionGate, validateConstraints, requiredConfigVersion, shiftConfiguration } from "../xpsState";
import type { Candidate, XpsPreview, XpsResult, XpsSource, XpsRequest } from "../xpsTypes";
import { estimateClickedPeak } from "../chartPeakPick";
import XpsFitControls from "./XpsFitControls.vue";
import XpsChart from "./XpsChart.vue";
import XpsResults from "./XpsResults.vue";
import FitScenarioComparison from './FitScenarioComparison.vue';
import AnalysisReportActions from './AnalysisReportActions.vue';
import type {AnalysisSnapshot} from '../analysisSnapshot';
import type {SingleSession} from '../sessionArchive';
const scenarioBusy=ref(false);
const analysisSnapshot=computed<AnalysisSnapshot|null>(()=>result.value?.configuration?{engine:'xps',configuration:result.value.configuration,result:result.value,stale:stale.value}:null);
const scenarioKey=computed(()=>JSON.stringify(config.value));
const props=defineProps<{x:number[];y:number[];source:XpsSource|null}>();
const units=computed(()=>spectrumUnits('xps',props.source));
const emit=defineEmits<{work:[dirty:boolean];template:[config:XpsRequest]}>();
const config=ref(createConfig(props.x,props.y,props.source)),preview=ref<XpsPreview|null>(null),result=ref<XpsResult|null>(null),candidates=ref<Candidate[]>([]);
const busy=ref(false),error=ref(""),stale=ref(false),notice=ref("");
const controls=ref<{showSection:(section:'range'|'baseline'|'peaks')=>void;selectPeak:(id:string,parameter?:string)=>void;focusRangeEndpoint:(endpoint:'start'|'end')=>void}|null>(null);
const chart=ref<{downloadImage:()=>void}|null>(null),fileInput=ref<HTMLInputElement|null>(null);
const selectedPeak=ref(''),resultSection=ref<HTMLElement|null>(null);
const resultViews=ref<{showResults:()=>void;showDiagnostics:()=>void;showArchive:()=>void}|null>(null);
const activePane=ref<'chart'|'settings'|'results'>('chart');
const resultsOpen=ref(false),resultTrigger=ref<HTMLButtonElement|null>(null);
watch(result,value=>{if(value){resultsOpen.value=true;chartExpanded.value=false;resultViews.value?.showResults();}});
const {grid,stacked,chartExpanded,settingsWidth,resultHeight,settingsMax,resultMax,layoutStyle,setSize,resetSizes}=useWorkbenchLayout(resultsOpen);
async function toggleChart(){chartExpanded.value=!chartExpanded.value;if(chartExpanded.value)activePane.value='chart';await nextTick();(chartExpanded.value?document.getElementById('analysis-plot'):grid.value?.closest('.single-workbench')?.querySelector<HTMLElement>('[data-test="expand-chart"]'))?.focus({preventScroll:true});}
function handleChartEscape(event:KeyboardEvent){if(chartExpanded.value&&!(event.target as HTMLElement)?.closest('dialog'))void toggleChart();}
async function viewResults(){chartExpanded.value=false;activePane.value='results';resultsOpen.value=true;await nextTick();resultSection.value?.focus({preventScroll:true});}
function handleResultsEscape(event:KeyboardEvent){if((event.target as HTMLElement)?.closest('dialog'))return;void closeResults();}
async function closeResults(){resultsOpen.value=false;activePane.value='chart';await nextTick();(resultTrigger.value?.getClientRects().length?resultTrigger.value:document.getElementById('analysis-plot'))?.focus({preventScroll:true});}
function locatePeak(id:string,parameter:string){if(stale.value||busy.value||scenarioBusy.value)return;void selectPeak(id,parameter);}
async function selectPeak(id:string,parameter?:string){if(!config.value.components.some(c=>c.id===id))return;if(!parameter&&selectedPeak.value===id&&activePane.value==='settings')return;chartExpanded.value=false;activePane.value='settings';if(parameter)resultsOpen.value=false;selectedPeak.value=id;await nextTick();void controls.value?.selectPeak(id,parameter);}
async function navigateView(view:'chart'|'settings'|'results'){
 chartExpanded.value=false;
 if(view==='results'){await viewResults();return;}
 activePane.value=view;resultsOpen.value=false;await nextTick();
 document.getElementById(view==='chart'?'analysis-plot':'analysis-settings')?.focus({preventScroll:true});
}
async function navigateReview(target:'baseline'|'peaks'|'chart'|'diagnostics'){
 if(target==='diagnostics'){await viewResults();resultViews.value?.showDiagnostics();return;}
 if(target==='chart'){await navigateView('chart');return;}
 await navigateView('settings');await controls.value?.showSection(target);
}
async function focusRangeEndpoint(endpoint:'start'|'end'){await navigateView('settings');controls.value?.focusRangeEndpoint(endpoint);}

const deletion=usePeakRemovalUndo(()=>config.value,removeComponent);
function undoDelete(){if(busy.value||scenarioBusy.value)return;const id=deletion.undo();if(id){notice.value='已恢复 '+id+'；请重新拟合。';selectPeak(id);}}
const initialWork=ref(JSON.stringify(config.value));
const unsavedWork=computed(()=>busy.value||Boolean(result.value)||JSON.stringify(config.value)!==initialWork.value);
watch(unsavedWork,dirty=>emit('work',dirty),{immediate:true});
useWorkProtection(()=>unsavedWork.value);
const gate=new RevisionGate();
const previewKey=computed(()=>JSON.stringify([config.value.x,config.value.y,config.value.shift_eV,config.value.range_start,config.value.range_end,{...config.value.background,confirmed:false}]));
watch(config,()=>{gate.invalidate();if(result.value)stale.value=true;},{deep:true,flush:"sync"});
watch(previewKey,()=>{preview.value=null;candidates.value=[];config.value.background.confirmed=false;},{flush:"sync"});
watch(()=>[props.x,props.y,props.source],()=>{config.value=createConfig(props.x,props.y,props.source);initialWork.value=JSON.stringify(config.value);selectedPeak.value='';preview.value=null;result.value=null;candidates.value=[];stale.value=false;error.value="";notice.value="";},{flush:"sync"});
const snapshot=()=>({...JSON.parse(JSON.stringify(config.value)),schema_version:requiredConfigVersion(config.value)});
async function action(kind:"preview"|"fit"|"candidates"){
  if(busy.value||scenarioBusy.value)return;
  error.value="";notice.value="";const token=gate.start(kind),request=snapshot();busy.value=true;
  try{
    if(kind==="fit"){
      if(restoredReview.value&&(!preview.value||!config.value.background.confirmed))throw new Error("恢复后请重新预览并复核背景");
      restoredReview.value=false;
      validateConstraints(request);
      const data=await fitXps(request);if(gate.current(token)){result.value=data;preview.value=data;stale.value=false;}
    }else if(kind==="preview"){
      const data=await previewXps(request);if(gate.current(token)){preview.value=data;notice.value=`背景已计算：${data.background.kind}，${data.background.iterations} 次迭代。`;}
    }else{
      const data=await candidatesXps(request);if(gate.current(token)){candidates.value=data.candidates;notice.value=data.note+(data.candidates.length?"":"；未检测到候选峰");}
    }
    if(!gate.current(token))notice.value="计算期间设置已变化，已丢弃过期响应。";
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
function removeAt(id:string){
  if(busy.value||scenarioBusy.value)return;
  error.value='';notice.value='';
  try{deletion.remove(id);notice.value=`已删除 ${id}；继续编辑前可撤销。`;}
  catch(e){error.value=e instanceof Error?e.message:String(e);}
}
function addAt(x:number){
  error.value='';notice.value='';
  try{
    if(config.value.background.kind!=='none'&&!preview.value)throw new Error('请先预览背景，再在图上添加峰');
    addComponent(config.value,estimateClickedPeak(props.x.map(v=>v+config.value.shift_eV),props.y,x,config.value.range_start,config.value.range_end,preview.value),preview.value);
  }catch(e){error.value=e instanceof Error?e.message:String(e);}
}
function template(){
  const r=result.value;if(!r||stale.value||!r.converged)return;
  const c=JSON.parse(JSON.stringify(r.configuration)) as XpsRequest;
  for(const peak of c.components){const fitted=r.components.find(p=>p.id===peak.id);if(fitted)for(const [name,p] of Object.entries(peak.parameters))if(p&&!p.fixed)p.value=fitted.parameters[name].value;}
  emit('template',c);
}
function range(value:{start:number;end:number}){config.value.range_start=value.start;config.value.range_end=value.end;}
function calibrate(value:number){
  if(!Number.isFinite(value)){error.value="能量偏移必须是有限数值";return;}
  shiftConfiguration(config.value,value-config.value.shift_eV);
}
function download(kind:"curves"|"parameters"|"configuration"){
  if(!result.value||stale.value||busy.value||scenarioBusy.value)return;
  error.value="";notice.value="";
  try{
    exportXpsResult(kind,result.value);
    notice.value="已发起当前结果的下载，请在浏览器下载列表中查看。";
  }catch(e){error.value='导出失败：'+(e instanceof Error?e.message:String(e));}
}
async function load(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file)return;
  const token=gate.start("load");busy.value=true;error.value="";
  try{const loaded=loadConfiguration(JSON.parse(await file.text()),props.x,props.y,props.source);validateConstraints(loaded);
    // 后端验证完整 schema 与背景，UI 不信任文件内的旧结果。
    const background=await previewXps(loaded);if(gate.current(token)){if(!await confirmDiscard(Boolean(result.value)||JSON.stringify(config.value)!==initialWork.value,'载入配置将替换 XPS 峰参数、背景复核与拟合结果。'))return;if(!gate.current(token))return;config.value=loaded;preview.value=background;config.value.background.confirmed=false;result.value=null;stale.value=false;notice.value="配置已载入并核对原数据，请复核背景并重新拟合。";}
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;input.value="";}
}

function sessionState():SingleSession{return {kind:'single',configuration:snapshot(),result:analysisSnapshot.value?JSON.parse(JSON.stringify(analysisSnapshot.value)):null};}
function restoreSession(w:SingleSession){
  gate.invalidate();config.value=JSON.parse(JSON.stringify(w.configuration));config.value.background.confirmed=false;
  result.value=w.result?.engine==='xps'?JSON.parse(JSON.stringify(w.result.result)):null;
  preview.value=null;candidates.value=[];stale.value=w.result?.stale??false;error.value='';notice.value='会话已恢复，未发起计算。继续拟合前请重新预览并复核背景。';restoredReview.value=true;
}
const restoredReview=ref(false);
defineExpose({sessionState,restoreSession,materialResultHint:()=>!result.value?'请先完成拟合，再计算材料参数。':stale.value?'参数已修改，请重新拟合后再计算材料参数。':'',isBusy:()=>busy.value||scenarioBusy.value});
</script>
<template><section class="xps-workbench single-workbench" :class="{'results-open':resultsOpen,'layout-stacked':stacked,'chart-expanded':chartExpanded}" :style="layoutStyle" @keydown.esc="handleChartEscape" :data-active-pane="activePane">

  <header class="single-workflow-toolbar">
    <WorkbenchLayoutTools :expanded="chartExpanded" :settings-width="settingsWidth" :result-height="resultHeight"
      :settings-max="settingsMax" :result-max="resultMax" :results-open="resultsOpen" :stacked="stacked"
      @toggle="toggleChart" @resize="setSize" @reset="resetSizes" />
    <span v-if="busy||stale" class="single-workflow-status" role="status">{{busy?'计算中':'参数已变更 · 需要重新拟合'}}</span>
    <div class="single-workflow-actions">
      <button v-show="!resultsOpen||chartExpanded" ref="resultTrigger" class="workbench-command single-results-toggle"
        type="button" :aria-expanded="resultsOpen&&!chartExpanded" aria-controls="analysis-results"
        data-test="toggle-results" @click="viewResults">结果与诊断</button>
      <WorkbenchMenu label="拟合配置" align-end close-on-action>
        <div class="single-config-actions">
          <button type="button" :disabled="busy||!source" @click="fileInput?.click()">复用拟合设置</button>
          <button type="button" :disabled="!result||stale||!result.converged||busy" data-test="multi-template" @click="template">用于批量拟合</button>
        </div>
      </WorkbenchMenu>
    </div>
  </header>
  <p v-if="error" class="error xps-message" role="alert">{{error}}</p><p v-if="notice" class="hint xps-message" role="status">{{notice}}</p>
  <label v-if="restoredReview&&config.background.kind!=='shirley'" class="xps-check confirmation-callout"><input v-model="config.background.confirmed" type="checkbox" :disabled="!preview||busy" />恢复后已重新预览并复核当前背景</label>
  <div v-if="deletion.canUndo.value" class="undo-peak-message" role="status"><span>继续编辑前可撤销最近删除的峰。</span><button type="button" data-test="undo-delete-peak" :disabled="busy||scenarioBusy" @click="undoDelete">撤销删除峰</button></div>
  <WorkbenchViewNav :active="activePane" @navigate="navigateView" /><div ref="grid" class="xps-grid"><aside id="analysis-settings" tabindex="-1" class="xps-control-column"><div class="configuration-actions"><input ref="fileInput" type="file" accept=".json,application/json" hidden @change="load" /></div><XpsFitControls ref="controls" :selected-peak="selectedPeak" :has-result="Boolean(result)" @remove="removeAt" @select="selectPeak" :config="config" :previewed="Boolean(preview)" :background-preview="preview" :busy="busy||scenarioBusy" :candidates="candidates" @preview="action('preview')" @fit="action('fit')" @candidates="action('candidates')" @error="error=$event" @calibrate="calibrate" /></aside>
    <WorkbenchSplitHandle label="调整设置栏宽度" controls="analysis-settings" side="settings" :value="settingsWidth" :min="232" :max="settingsMax" @resize="setSize('settings',$event)" />
    <XpsChart :units="units" :read-only="busy||scenarioBusy" id="analysis-plot" tabindex="-1" :selected-peak="selectedPeak" @select="selectPeak" ref="chart" :components="config.components" :x="x" :y="y" :shift="config.shift_eV" :start="Number(config.range_start)" :end="Number(config.range_end)" :preview="preview" :result="stale?null:result" @range-endpoint-focus="focusRangeEndpoint" @add-peak="addAt" @remove-peak="removeAt" @range="range" />
    <WorkbenchSplitHandle v-show="resultsOpen" label="调整结果区高度" controls="analysis-results" side="results" orientation="horizontal" :value="resultHeight" :min="160" :max="resultMax" @resize="setSize('results',$event)" />
    <aside id="analysis-results" ref="resultSection" tabindex="-1" aria-label="拟合结果" class="xps-result-column" @keydown.esc.stop="handleResultsEscape"><ResultWorkspace workstation ref="resultViews"><template #tools><button class="single-results-close" type="button" @click="closeResults">收起结果</button></template><XpsResults :y-unit="units.y" locatable @navigate="navigateReview" @locate="locatePeak" :selected-peak="selectedPeak" @select="selectedPeak=$event" :result="result" :stale="stale" :busy="busy||scenarioBusy" @export="download" @image="chart?.downloadImage()" />
  <template #archive><div class="analysis-archive">
  <FitScenarioComparison :snapshot="analysisSnapshot" :current-key="scenarioKey" :busy="busy" @activity="scenarioBusy=$event" />
  <AnalysisReportActions :entries="analysisSnapshot?[{label:source?.filename??'当前 XPS 谱线',snapshot:analysisSnapshot,status:stale?'已过期':'已计算'}]:[]" :disabled="busy||scenarioBusy" />
  </div></template></ResultWorkspace></aside></div>
</section></template>
