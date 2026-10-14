<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import {resultDiagnostics} from '../resultDiagnostics';
import AnalysisReportActions from './AnalysisReportActions.vue';
import {clone} from '../multipeakState';
import {isMulti} from '../fitAdapter';
import {previewMulti} from '../multipeakApi';
import {previewXps} from '../xpsApi';
import {snapshotPeaks,snapshotUnit,type AnalysisSnapshot} from '../analysisSnapshot';
import {calculateScenario,type FitScenario} from '../fitScenarios';
import type {BatchRequest} from '../batchTypes';
import type {MultiPreview} from '../multipeakTypes';
import type {XpsPreview} from '../xpsTypes';
import BatchResultChart from './BatchResultChart.vue';
import {formatResultNumber as fmt} from '../resultPresentation';
const props=defineProps<{snapshot:AnalysisSnapshot|null;currentKey:string;busy:boolean}>();
const emit=defineEmits<{activity:[value:boolean]}>();
const base=ref<AnalysisSnapshot|null>(null),origin=ref(''),draft=ref<BatchRequest|null>(null),items=ref<FitScenario[]>([]),error=ref(''),name=ref('替代方案'),working=ref(false),confirmed=ref(false),preview=ref<MultiPreview|XpsPreview|null>(null);
let revision=0;
const obsolete=computed(()=>Boolean(base.value&&origin.value!==props.currentKey));
const unit=computed(()=>base.value?snapshotUnit(base.value):'X 单位');
const background=computed(()=>draft.value?(isMulti(draft.value)?draft.value.baseline:draft.value.background):null);
watch(draft,()=>{revision++;preview.value=null;confirmed.value=false;},{deep:true});
watch(working,v=>emit('activity',v));
function capture(){if(!props.snapshot||props.snapshot.stale||working.value)return;base.value=clone(props.snapshot);origin.value=props.currentKey;items.value=[];draft.value=clone(base.value.configuration);name.value='替代方案 1';error.value='';}
function backgroundChanged(event:Event){if(!draft.value)return;const kind=(event.target as HTMLSelectElement).value;if(isMulti(draft.value)){draft.value.baseline.kind=kind as 'none'|'line';draft.value.baseline.anchors=[];}else{draft.value.background.kind=kind as 'none'|'line';draft.value.background.low_level=null;draft.value.background.high_level=null;}}
async function inspect(){if(!draft.value||working.value)return;const request=clone(draft.value),version=revision;working.value=true;error.value='';try{const data=isMulti(request)?await previewMulti(request):await previewXps(request);if(version===revision)preview.value=data;}catch(e){error.value=String(e);}finally{working.value=false;}}
async function solve(){
  if(!base.value||!draft.value||working.value||!preview.value||!confirmed.value||items.value.length>=8)return;
  const configuration=clone(draft.value);if(isMulti(configuration))configuration.baseline.confirmed=true;else configuration.background.confirmed=true;
  const item:FitScenario={id:crypto.randomUUID(),name:name.value.trim()||`方案 ${items.value.length+1}`,configuration,result:null,error:'',origin:origin.value,running:true};items.value.push(item);working.value=true;
  await calculateScenario(items.value.at(-1)!,base.value);working.value=false;name.value=`替代方案 ${items.value.length+1}`;
}
const comparison=computed(()=>base.value?[{id:'base',name:'保存的主方案',snapshot:base.value,error:''},...items.value.map(i=>({id:i.id,name:i.name,snapshot:i.result,error:i.running?'计算中':i.error}))]:[]);
</script>
<template>
  <details class="panel scenario-comparison"><summary>方案敏感性比较 · 不修改主配置</summary>
    <p class="hint">先保存当前拟合快照，再单独改变区间、背景或自由参数初值。每个替代方案使用原求解器；差异不是置信区间或系统误差完整估计，不自动按 AICc/BIC 排名。最多 8 个替代方案。</p>
    <button :disabled="!snapshot||snapshot.stale||busy||working" @click="capture">{{base?'重新保存主方案并清空比较':'保存当前拟合为主方案'}}</button>
    <p v-if="obsolete" class="warning" role="status">主工作区已改变：以下保存方案属于旧配置，不会覆盖当前工作。</p>
    <template v-if="base&&draft&&background">
      <fieldset :disabled="working||busy"><legend>替代方案设置</legend><div class="batch-trend-controls"><label>方案名称<input v-model="name" maxlength="120" /></label><label>区间下限<input v-model.number="draft.range_start" type="number" step="any" /></label><label>区间上限<input v-model.number="draft.range_end" type="number" step="any" /></label></div>
        <label>方案背景<select :value="background.kind" @change="backgroundChanged"><option :value="background.kind">沿用：{{background.kind}}</option><option value="none">无背景</option><option value="line">端点直线背景</option></select></label>
        <details><summary>调整自由参数初值（固定值和约束保持）</summary><div class="compact-result-table" tabindex="0" role="region" aria-label="方案初值"><table><tbody><template v-for="c in draft.components" :key="c.id"><tr v-for="(p,key) in c.parameters" :key="String(key)"><th>{{c.id}} · {{key}}</th><td><input v-if="p" v-model.number="p.value" type="number" step="any" :aria-label="`方案 ${c.id} ${key} 初值`" :disabled="p.fixed||draft.constraints.some(l=>l.target.component===c.id&&l.target.parameter===key)" /></td></tr></template></tbody></table></div></details>
        <button @click="inspect">预览方案背景</button>
      </fieldset>
      <BatchResultChart v-if="preview" :request="draft" :preview="preview" :result="null" selected-peak="" />
      <label v-if="preview" class="xps-check"><input v-model="confirmed" type="checkbox" :disabled="working" />已检查此方案区间与背景</label><button :disabled="working||busy||!preview||!confirmed||items.length>=8" @click="solve">{{working?'方案计算中…':'计算并保存替代方案'}}</button>
      <p v-if="error" class="error" role="alert">{{error}}</p>
      <div class="compact-result-table" tabindex="0" role="region" aria-label="方案结果比较"><table><thead><tr><th>方案 / 峰</th><th>状态</th><th>峰顶 / {{unit}}</th><th>FWHM / {{unit}}</th><th>区间面积</th><th>全域面积</th></tr></thead><tbody><template v-for="item in comparison" :key="item.id"><tr v-if="!item.snapshot"><th>{{item.name}}</th><td colspan="5">{{item.error||'无结果'}}</td></tr><tr v-for="p in item.snapshot?snapshotPeaks(item.snapshot):[]" :key="p.id"><th>{{item.name}} / {{p.id}}</th><td><template v-if="item.snapshot">{{resultDiagnostics(item.snapshot.result).calculation}} · {{resultDiagnostics(item.snapshot.result).diagnostic}}<details v-if="resultDiagnostics(item.snapshot.result).warnings.length"><summary>查看诊断</summary><p v-for="warning in resultDiagnostics(item.snapshot.result).warnings" :key="warning">{{warning}}</p></details></template></td><td>{{fmt(p.geometry?.peak_position)}}</td><td>{{fmt(p.geometry?.fwhm)}}</td><td>{{fmt(p.areaWindow)}}</td><td>{{fmt(p.areaTotal)}}</td></tr></template></tbody></table></div>
      <p class="hint">面积单位 Y × {{unit}}。改变背景或观测点集后，统计指标不可直接当作同一目标函数比较；失败方案保留原因。临时方案不进入本地会话；刷新前可在下方导出比较摘要。</p>
      <AnalysisReportActions :entries="comparison.map(i=>({label:i.name,status:i.error||'已计算',snapshot:i.snapshot?{...i.snapshot,stale:obsolete}:null,note:'方案差异不是置信区间；区间或背景不同不进行 AICc/BIC 排名。'}))" :disabled="working||busy" />
    </template>
  </details>
</template>
<style scoped>.scenario-comparison{margin-top:16px;min-width:0}.scenario-comparison fieldset{margin:12px 0;min-width:0}.scenario-comparison input{max-width:100%}.scenario-comparison button{min-height:40px;white-space:normal;height:auto}</style>
