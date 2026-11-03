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
import { computed, nextTick, ref, watch } from 'vue';
import { runFit, previewBaseline, analyzePeak, compareModels, downloadExport } from '../api';
import { singleRequest, singlePlot, readSingleSettings, type SingleSolverSettings } from '../singleFitAdapter';
import type { FitResult, ModelComparison, PeakModel } from '../types';
import ResultsPanel from './ResultsPanel.vue';
import { fitMulti, previewMulti, candidatesMulti } from '../multipeakApi';
import { removeMultiComponent, addMultiComponent, createMultiConfig, validateMulti, clone, loadMultiConfiguration } from '../multipeakState';
import { RevisionGate } from '../xpsState';
import { estimateClickedPeak } from '../chartPeakPick';
import { csv, saveFile } from '../resultExport';
import { multiExportRows } from '../multipeakResultExport';
import type { MultiMode, MultiPreview, MultiResult, MultiRequest } from '../multipeakTypes';
import type { XpsSource, Candidate } from '../xpsTypes';
import MultiPeakControls from './MultiPeakControls.vue';
import MultiPeakChart from './MultiPeakChart.vue';
import MultiPeakResults from './MultiPeakResults.vue';
import FitScenarioComparison from './FitScenarioComparison.vue';
import AnalysisReportActions from './AnalysisReportActions.vue';
import type {AnalysisSnapshot} from '../analysisSnapshot';
import type {SingleSession} from '../sessionArchive';
const props=defineProps<{x:number[];y:number[];source:XpsSource|null;mode:MultiMode;dataLoading?:boolean;unified?:boolean}>();
const units=computed(()=>spectrumUnits(props.mode,props.source));
const emit=defineEmits<{work:[value:{mode:'single'|'xrd';dirty:boolean}];template:[config:MultiRequest]}>();
function initialConfig(){
  const c=createMultiConfig(props.x,props.y,props.source,props.mode);
  if(props.unified)c.solver={max_nfev:2000,tolerance:1e-8};
  return c;
}
const singleSettings=ref<SingleSolverSettings>({staged:true,centerEvaluations:20});
const singleFit=ref<{result:FitResult;configuration:MultiRequest;settings:SingleSolverSettings}|null>(null);
const comparison=ref<ModelComparison|null>(null),comparing=ref(false),scenarioBusy=ref(false);
const analysisSnapshot=computed<AnalysisSnapshot|null>(()=>singleFit.value?{engine:'single',configuration:singleFit.value.configuration,result:singleFit.value.result,singleSettings:singleFit.value.settings,stale:stale.value}:result.value?.configuration?{engine:'multi',configuration:result.value.configuration,result:result.value,stale:stale.value}:null);
const scenarioKey=computed(()=>JSON.stringify([config.value,singleSettings.value]));
const config=ref(initialConfig()),preview=ref<MultiPreview|null>(null),result=ref<MultiResult|null>(null),candidates=ref<Candidate[]>([]);
const peakModel=ref<PeakModel>('gaussian');
const busy=ref(false),stale=ref(false),error=ref(''),notice=ref('');
const fileInput=ref<HTMLInputElement|null>(null),chart=ref<{downloadImage:()=>void}|null>(null);
const controls=ref<{showSection:(section:'range'|'baseline'|'peaks')=>void;selectPeak:(id:string,parameter?:string)=>void;focusRangeEndpoint:(endpoint:'start'|'end')=>void;openAnchors:(index?:number)=>void}|null>(null);
const selectedPeak=ref(''),resultSection=ref<HTMLElement|null>(null);
const resultViews=ref<{showResults:()=>void;showDiagnostics:()=>void;showArchive:()=>void}|null>(null);
const activePane=ref<'chart'|'settings'|'results'>('chart');
const resultsOpen=ref(false),resultTrigger=ref<HTMLButtonElement|null>(null);
const {grid,stacked,chartExpanded,settingsWidth,resultHeight,settingsMax,resultMax,layoutStyle,setSize,resetSizes}=useWorkbenchLayout(resultsOpen);
async function toggleChart(){chartExpanded.value=!chartExpanded.value;if(chartExpanded.value)activePane.value='chart';await nextTick();(chartExpanded.value?document.getElementById('analysis-plot'):grid.value?.closest('.single-workbench')?.querySelector<HTMLElement>('[data-test="expand-chart"]'))?.focus({preventScroll:true});}
function handleChartEscape(event:KeyboardEvent){if(chartExpanded.value&&!(event.target as HTMLElement)?.closest('dialog'))void toggleChart();}
async function viewResults(){chartExpanded.value=false;activePane.value='results';resultsOpen.value=true;await nextTick();resultSection.value?.focus({preventScroll:true});}
function handleResultsEscape(event:KeyboardEvent){if((event.target as HTMLElement)?.closest('dialog'))return;void closeResults();}
async function closeResults(){resultsOpen.value=false;activePane.value='chart';await nextTick();(resultTrigger.value?.getClientRects().length?resultTrigger.value:document.getElementById('analysis-plot'))?.focus({preventScroll:true});}
function locatePeak(id:string,parameter:string){if(stale.value||busy.value||scenarioBusy.value||comparing.value)return;void selectPeak(id,parameter);}
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
async function editAnchor(index:number){await navigateView('settings');controls.value?.openAnchors(index);}
async function focusRangeEndpoint(endpoint:'start'|'end'){await navigateView('settings');controls.value?.focusRangeEndpoint(endpoint);}

const deletion=usePeakRemovalUndo(()=>config.value,removeMultiComponent);
function undoDelete(){if(busy.value||scenarioBusy.value)return;const id=deletion.undo();if(id){notice.value='已恢复 '+id+'；请重新拟合。';selectPeak(id);}}
const initialWork=ref(JSON.stringify(config.value));
const unsavedWork=computed(()=>busy.value||hasResult.value||JSON.stringify(config.value)!==initialWork.value);
useWorkProtection(()=>unsavedWork.value);
const gate=new RevisionGate();let sequence=0;
const singleMode=computed(()=>Boolean(props.unified)&&config.value.components.filter(c=>c.enabled).length===1);
const hasResult=computed(()=>Boolean(result.value||singleFit.value));
watch([result,singleFit],([multi,single])=>{if(multi||single){resultsOpen.value=true;chartExpanded.value=false;resultViews.value?.showResults();}});
watch(unsavedWork,dirty=>emit('work',{mode:props.mode==='xrd'?'xrd':'single',dirty}),{immediate:true});
const converged=computed(()=>result.value?.converged??singleFit.value?.result.converged??false);
const plottedResult=computed(()=>stale.value?null:singleFit.value?singlePlot(singleFit.value.result,singleFit.value.configuration.components.find(c=>c.enabled)!):result.value);
function invalidate(){gate.invalidate();sequence++;busy.value=false;comparing.value=false;comparison.value=null;if(hasResult.value)stale.value=true;}
watch(singleSettings,invalidate,{deep:true,flush:'sync'});
const baselineKey=computed(()=>JSON.stringify([config.value.x,config.value.y,config.value.range_start,config.value.range_end,{...config.value.baseline,confirmed:false}]));
watch(config,invalidate,{deep:true,flush:'sync'});
watch(baselineKey,()=>{preview.value=null;candidates.value=[];config.value.baseline.confirmed=false;},{flush:'sync'});
watch(()=>[props.x,props.y,props.source,props.mode],()=>{config.value=initialConfig();initialWork.value=JSON.stringify(config.value);selectedPeak.value='';result.value=null;singleFit.value=null;preview.value=null;stale.value=false;error.value='';notice.value='';},{flush:'sync'});
async function preparePreview(request:MultiRequest,settings:SingleSolverSettings):Promise<MultiPreview>{
  if(!props.unified||request.components.filter(c=>c.enabled).length!==1)return previewMulti(request);
  const data=await previewBaseline(singleRequest(request,settings)),observations=new Map(request.x.map((x,i)=>[x,request.y[i]]));
  return {x:data.x,baseline:data.baseline,raw_y:data.x.map(x=>observations.get(x)!),baseline_configuration:{...request.baseline,resolved_anchors:request.baseline.anchors}};
}
async function action(kind:'fit'|'preview'|'candidates'|'auto'){
  if(busy.value||scenarioBusy.value||props.dataLoading)return;
  const request=clone(config.value),token=gate.start(kind),task=++sequence;busy.value=true;error.value='';notice.value='';
  try{
    if(kind==='fit'){
      if(restoredReview.value&&(!preview.value||!config.value.baseline.confirmed))throw new Error('恢复后请重新预览并复核背景');
      restoredReview.value=false;
      if(!request.components.some(c=>c.enabled))throw new Error('请先手动添加或启用峰');
      if(request.components.some(c=>c.model!==peakModel.value))throw new Error('请先选择一种统一峰函数应用到全部峰');
      if(singleMode.value){
        if(request.baseline.kind!=='none'&&!request.baseline.confirmed)throw new Error('请先预览并复核当前基线');
        const settings=clone(singleSettings.value),data=await runFit(singleRequest(request,settings));
        if(gate.current(token)){singleFit.value={result:data,configuration:request,settings};result.value=null;preview.value={x:data.x,raw_y:data.raw_y,baseline:data.baseline,baseline_configuration:{...request.baseline,resolved_anchors:request.baseline.anchors}};stale.value=false;}
      }else{validateMulti(request);const data=await fitMulti(request);if(gate.current(token)){result.value=data;singleFit.value=null;preview.value=data;stale.value=false;}}
    }
    else if(kind==='auto'){
      const data=await analyzePeak(singleRequest(request,clone(singleSettings.value)));
      if(gate.current(token)){
        const peak=config.value.components.find(c=>c.enabled)!;
        for(const [name,p] of Object.entries(peak.parameters))if(p&&!p.fixed&&Number.isFinite(data.initial_parameters[name]))p.value=Math.max(p.lower??-Infinity,Math.min(p.upper??Infinity,data.initial_parameters[name]));
        notice.value='已采用自动初值；固定参数和边界保留。'+(data.warnings??[]).join('；');
      }
    }
    else if(kind==='preview'){const data=await preparePreview(request,clone(singleSettings.value));if(gate.current(token)){preview.value=data;notice.value='基线已预览，请检查曲线并勾选复核。';}}
    else {const data=await candidatesMulti({...request,solver:{max_nfev:3000,tolerance:1e-9}});if(gate.current(token)){candidates.value=data.candidates;notice.value=data.note+(data.candidates.length?'':' 未检测到候选峰，可手工添加。');}}
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{if(task===sequence)busy.value=false;}
}
async function compare(includeAsymmetric=false){
  if(!singleMode.value||comparing.value||busy.value||stale.value)return;
  const token=gate.start('compare');comparing.value=true;error.value='';
  try{const data=await compareModels(singleRequest(clone(config.value),clone(singleSettings.value)),includeAsymmetric);if(gate.current(token))comparison.value=data;}
  catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{if(gate.current(token))comparing.value=false;}
}
async function exportSingle(kind:'curves'|'parameters'){
  if(!singleFit.value||stale.value||busy.value)return;
  const {result,configuration}=singleFit.value;
  try{const blob=await downloadExport(kind,result,spectrumUnits(configuration.analysis_mode,configuration.source));const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`single-${kind}.csv`;a.click();URL.revokeObjectURL(url);}
  catch(e){error.value=e instanceof Error?e.message:String(e);}
}
function removeAt(id:string){
  if(busy.value||scenarioBusy.value)return;
  error.value='';notice.value='';
  try{deletion.remove(id);notice.value=`已删除 ${id}；继续编辑前可撤销。`;}
  catch(e){error.value=e instanceof Error?e.message:String(e);}
}
function addAt(x:number){
  error.value='';notice.value='';
  try{addMultiComponent(config.value,estimateClickedPeak(props.x,props.y,x,config.value.range_start,config.value.range_end,preview.value),preview.value,peakModel.value);notice.value=`已在 ${x.toPrecision(6)} 添加峰，可在“统一调整峰参数”中调整。`;}
  catch(e){error.value=e instanceof Error?e.message:String(e);}
}
function download(kind:'curves'|'parameters'|'configuration'){
  if(stale.value||busy.value)return;
  if(singleFit.value){if(kind==='configuration')saveFile('peak-fit-result.json',JSON.stringify({...singleFit.value,single_solver_settings:singleSettings.value},null,2),'application/json');else void exportSingle(kind);return;}
  const r=result.value;if(!r)return;
  if(kind==='configuration'){saveFile('multipeak-result.json',JSON.stringify({...r,...(props.unified?{single_solver_settings:singleSettings.value}:{})},null,2),'application/json');return;}
  saveFile(`multipeak-${kind}.csv`,csv(multiExportRows(kind,r)));
}
async function load(event:Event){
  const input=event.target as HTMLInputElement,file=input.files?.[0];if(!file||busy.value)return;
  const token=gate.start('load'),task=++sequence;busy.value=true;error.value='';
  try{const artifact=JSON.parse(await file.text()),settings=readSingleSettings(artifact.single_solver_settings);const c=loadMultiConfiguration(artifact,props.x,props.y,props.source,props.mode,c=>{if(props.unified&&c.components.filter(p=>p.enabled).length===1)singleRequest(c,settings);else validateMulti(c);});const p=await preparePreview(c,settings);if(gate.current(token)){if(!await confirmDiscard(hasResult.value||JSON.stringify(config.value)!==initialWork.value,'载入配置将替换当前峰参数、基线复核与拟合结果。'))return;if(!gate.current(token))return;busy.value=false;singleSettings.value=settings;config.value=c;peakModel.value=c.components[0]?.model??peakModel.value;preview.value=p;result.value=null;singleFit.value=null;stale.value=false;notice.value=c.components.some(p=>p.model!==peakModel.value)?'已恢复历史配置，请选择一种统一峰函数，再复核基线并拟合。':'配置已核对；请重新复核基线并拟合。';}}
  catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{if(task===sequence)busy.value=false;input.value='';}
}
function template(){
  const r=result.value;if(!hasResult.value||stale.value||!converged.value)return;
  const c=clone(r?.configuration??singleFit.value!.configuration);
  for(const peak of c.components){const fitted=r?r.components.find(p=>p.id===peak.id):(peak.enabled?singleFit.value!.result:null);if(fitted)for(const [name,p] of Object.entries(peak.parameters))if(p&&!p.fixed)p.value=fitted.parameters[name].value;}
  emit('template',c);
}

function sessionState():SingleSession{return {kind:'single',configuration:clone(config.value),result:analysisSnapshot.value?clone(analysisSnapshot.value):null,single_settings:clone(singleSettings.value)};}
function restoreSession(w:SingleSession){
  invalidate();config.value=clone(w.configuration) as MultiRequest;config.value.baseline.confirmed=false;
  singleSettings.value=readSingleSettings(w.single_settings);peakModel.value=config.value.components[0]?.model??'gaussian';
  singleFit.value=w.result?.engine==='single'?{configuration:clone(w.result.configuration) as MultiRequest,result:clone(w.result.result) as FitResult,settings:readSingleSettings(w.result.singleSettings)}:null;
  result.value=w.result?.engine==='multi'?clone(w.result.result) as MultiResult:null;
  preview.value=null;candidates.value=[];stale.value=w.result?.stale??false;error.value='';notice.value='会话已恢复，未发起计算。继续拟合前请重新预览并复核背景。';
  restoredReview.value=true;
}
const restoredReview=ref(false);
defineExpose({sessionState,restoreSession,materialResultHint:()=>!hasResult.value?'请先完成拟合，再计算材料参数。':stale.value?'参数已修改，请重新拟合后再计算材料参数。':'',isBusy:()=>busy.value||comparing.value||scenarioBusy.value});
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
          <button type="button" :disabled="!hasResult||stale||!converged||busy" data-test="multi-template" @click="template">用于批量拟合</button>
        </div>
      </WorkbenchMenu>
    </div>
  </header>
  <p v-if="error" role="alert" class="error xps-message">{{error}}</p><p v-if="notice" role="status" class="hint xps-message">{{notice}}</p>
  <label v-if="restoredReview&&config.baseline.kind==='none'" class="xps-check confirmation-callout"><input v-model="config.baseline.confirmed" type="checkbox" :disabled="!preview||busy" />恢复后已重新预览并复核当前背景</label>
  <div v-if="deletion.canUndo.value" class="undo-peak-message" role="status"><span>继续编辑前可撤销最近删除的峰。</span><button type="button" data-test="undo-delete-peak" :disabled="busy||scenarioBusy" @click="undoDelete">撤销删除峰</button></div>
  <WorkbenchViewNav :active="activePane" @navigate="navigateView" /><div ref="grid" class="xps-grid"><aside id="analysis-settings" tabindex="-1" class="xps-control-column"><div class="configuration-actions"><input ref="fileInput" type="file" accept=".json" hidden @change="load" /></div><MultiPeakControls ref="controls" :selected-peak="selectedPeak" :has-result="Boolean(hasResult)" @remove="removeAt" @select="selectPeak" :unified="unified" :model="peakModel" @model="peakModel=$event;error=''" :config="config" :preview="preview" :busy="busy||scenarioBusy||Boolean(dataLoading)" :candidates="candidates" @fit="action('fit')" @preview="action('preview')" @candidates="action('candidates')" @error="error=$event">
      <template v-if="unified" #single-tools><p class="hint" data-test="fit-count">{{config.components.filter(c=>c.enabled).length}} 个启用峰 · {{singleMode?'单峰拟合':config.components.some(c=>c.enabled)?'联合拟合':'请添加或启用峰'}}</p><button v-if="singleMode" :disabled="busy||dataLoading" data-test="auto-analyze" @click="action('auto')">自动估计并采用初值</button></template>
      <template v-if="singleMode" #solver><label class="xps-check"><input v-model="singleSettings.staged" type="checkbox" />固定峰中心预拟合，再释放中心</label><label v-if="singleSettings.staged">中心固定阶段上限<input v-model.number="singleSettings.centerEvaluations" type="number" min="0" max="500" /></label></template>
    </MultiPeakControls></aside>
    <WorkbenchSplitHandle label="调整设置栏宽度" controls="analysis-settings" side="settings" :value="settingsWidth" :min="232" :max="settingsMax" @resize="setSize('settings',$event)" />
    <MultiPeakChart :units="units" :read-only="busy||scenarioBusy" id="analysis-plot" tabindex="-1" :selected-peak="selectedPeak" @select="selectPeak" ref="chart" :anchors="config.baseline.kind==='none'?[]:config.baseline.anchors" :can-add-anchors="unified&&config.baseline.kind!=='none'&&x.length>0&&!busy&&!scenarioBusy&&!dataLoading" @anchor="config.baseline.anchors.push($event)" @edit-anchor="editAnchor" @move-anchor="(index,point)=>config.baseline.anchors.splice(index,1,point)" :components="config.components" :x="x" :y="y" :mode="mode" :start="Number(config.range_start)" :end="Number(config.range_end)" :preview="preview" :result="plottedResult" @range-endpoint-focus="focusRangeEndpoint" @add-peak="addAt" @remove-peak="removeAt" @range="config.range_start=$event.start;config.range_end=$event.end" />
    <WorkbenchSplitHandle v-show="resultsOpen" label="调整结果区高度" controls="analysis-results" side="results" orientation="horizontal" :value="resultHeight" :min="160" :max="resultMax" @resize="setSize('results',$event)" />
    <aside id="analysis-results" ref="resultSection" tabindex="-1" aria-label="拟合结果" class="xps-result-column" @keydown.esc.stop="handleResultsEscape"><ResultWorkspace workstation ref="resultViews"><template #tools><button class="single-results-close" type="button" @click="closeResults">收起结果</button></template><template v-if="singleFit||singleMode&&!result"><ResultsPanel :units="units" locatable @navigate="navigateReview" @locate="locatePeak" :selected-peak="selectedPeak" :peak-id="singleFit?.configuration.components.find(c=>c.enabled)?.id" :peak-label="singleFit?.configuration.components.find(c=>c.enabled)?.label" @select="selectedPeak=$event" :result="singleFit?.result??null" :stale="stale" :fitting="busy||scenarioBusy||comparing" :comparing="comparing" :comparison="comparison" :error="error" :analysis-mode="mode==='xrd'?'xrd':'single'" @compare="compare" @export="exportSingle" @export-image="chart?.downloadImage()"><template #export-extra><button v-if="singleFit" :disabled="stale||busy" @click="download('configuration')">配置 JSON</button></template></ResultsPanel></template><MultiPeakResults locatable @navigate="navigateReview" @locate="locatePeak" :selected-peak="selectedPeak" @select="selectedPeak=$event" v-else :result="result" :stale="stale" :busy="busy||scenarioBusy" :unit="units.x" :y-unit="units.y" @export="download" @image="chart?.downloadImage()" />
  <template #archive><div class="analysis-archive">
  <FitScenarioComparison :snapshot="analysisSnapshot" :current-key="scenarioKey" :busy="busy||Boolean(dataLoading)" @activity="scenarioBusy=$event" />
  <AnalysisReportActions :entries="analysisSnapshot?[{label:source?.filename??'当前谱线',snapshot:analysisSnapshot,status:stale?'已过期':'已计算'}]:[]" :disabled="busy||scenarioBusy" />
  </div></template></ResultWorkspace></aside></div>
</section></template>
