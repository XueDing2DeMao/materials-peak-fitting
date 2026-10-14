<script setup lang="ts">
import { confirmDiscard, useWorkProtection } from '../useWorkProtection';
import { computed, ref, watch } from "vue";
import { candidatesXps, exportXps, fitXps, previewXps } from "../xpsApi";
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
const emit=defineEmits<{work:[dirty:boolean];template:[config:XpsRequest]}>();
const config=ref(createConfig(props.x,props.y,props.source)),preview=ref<XpsPreview|null>(null),result=ref<XpsResult|null>(null),candidates=ref<Candidate[]>([]);
const busy=ref(false),error=ref(""),stale=ref(false),notice=ref("");
const controls=ref<{focusRangeEndpoint:(endpoint:'start'|'end')=>void}|null>(null);
const chart=ref<{downloadImage:()=>void}|null>(null),fileInput=ref<HTMLInputElement|null>(null);
const selectedPeak=ref(''),resultSection=ref<HTMLElement|null>(null);
function viewResults(){resultSection.value?.scrollIntoView?.({block:'start',behavior:'smooth'});resultSection.value?.focus({preventScroll:true});}
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
  error.value='';notice.value='';
  try{removeComponent(config.value,id);notice.value=`已删除 ${id}，可继续左键添加或右键删除峰。`;}
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
async function download(kind:"curves"|"parameters"|"configuration"){
  if(!result.value||stale.value||busy.value)return;
  const token=gate.start("export");busy.value=true;error.value="";
  try{const blob=await exportXps(kind,snapshot());if(!gate.current(token)){notice.value="设置已变化，已取消过期导出。";return;}
    const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=`xps-${kind}.${kind==="configuration"?"json":"csv"}`;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }catch(e){if(gate.current(token))error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
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
defineExpose({sessionState,restoreSession,isBusy:()=>busy.value||scenarioBusy.value});
</script>
<template><section class="xps-workbench">
  <div class="xps-toolbar"><span>多峰 XPS · {{source?`${source.sheet} / ${source.y_column}`:'请先导入并选择谱列'}}</span><div class="workbench-tools" role="group" aria-label="配置操作"><button :disabled="busy||!source||!x.length" @click="fileInput?.click()">加载配置 JSON</button><button :disabled="!result||stale||!result.converged||busy" @click="template">用当前配置批量拟合</button><input ref="fileInput" type="file" accept=".json,application/json" hidden @change="load" /></div></div>
  <p v-if="result&&!stale&&!busy" role="status" class="fit-complete-notice">拟合计算已返回，请查看诊断。<button @click="viewResults">查看结果</button></p>
  <p v-if="error" class="error xps-message" role="alert">{{error}}</p><p v-if="notice" class="hint xps-message" role="status">{{notice}}</p>
  <label v-if="restoredReview&&config.background.kind!=='shirley'" class="xps-check confirmation-callout"><input v-model="config.background.confirmed" type="checkbox" :disabled="!preview||busy" />恢复后已重新预览并复核当前背景</label>
  <div class="xps-grid"><aside id="analysis-settings" tabindex="-1" class="xps-control-column"><XpsFitControls ref="controls" :config="config" :previewed="Boolean(preview)" :background-preview="preview" :busy="busy||scenarioBusy" :candidates="candidates" @preview="action('preview')" @fit="action('fit')" @candidates="action('candidates')" @error="error=$event" @calibrate="calibrate" /></aside>
    <XpsChart id="analysis-plot" :selected-peak="selectedPeak" ref="chart" :components="config.components" :x="x" :y="y" :shift="config.shift_eV" :start="Number(config.range_start)" :end="Number(config.range_end)" :preview="preview" :result="stale?null:result" @range-endpoint-focus="controls?.focusRangeEndpoint($event)" @add-peak="addAt" @remove-peak="removeAt" @range="range" />
    <aside id="analysis-results" ref="resultSection" tabindex="-1" aria-label="拟合结果" class="xps-result-column"><XpsResults :selected-peak="selectedPeak" @select="selectedPeak=$event" :result="result" :stale="stale" :busy="busy" @export="download" @image="chart?.downloadImage()" />
  <div class="analysis-archive"><div class="archive-heading"><h2>比较与归档</h2><span>复核后记录分析依据</span></div>
  <FitScenarioComparison :snapshot="analysisSnapshot" :current-key="scenarioKey" :busy="busy" @activity="scenarioBusy=$event" />
  <AnalysisReportActions :entries="analysisSnapshot?[{label:source?.filename??'当前 XPS 谱线',snapshot:analysisSnapshot,status:stale?'已过期':'已计算'}]:[]" :disabled="busy||scenarioBusy" />
  </div></aside></div>
</section></template>
