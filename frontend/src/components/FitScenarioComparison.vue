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
const xpsBackground=computed(()=>draft.value&&!isMulti(draft.value)?draft.value.background:null);
const originalBackground=computed(()=>{
  const configuration=base.value?.configuration;
  if(!configuration)return null;
  return isMulti(configuration)?configuration.baseline:configuration.background;
});
watch(draft,()=>{revision++;preview.value=null;confirmed.value=false;},{deep:true});
watch(working,v=>emit('activity',v));
function capture(){if(!props.snapshot||props.snapshot.stale||working.value)return;base.value=clone(props.snapshot);origin.value=props.currentKey;items.value=[];draft.value=clone(base.value.configuration);name.value='替代方案 1';error.value='';}
function backgroundChanged(event:Event){
  const configuration=draft.value,source=base.value?.configuration;
  if(!configuration||!source)return;
  const kind=(event.target as HTMLSelectElement).value;
  if(isMulti(configuration)&&isMulti(source)){
    if(kind===source.baseline.kind){configuration.baseline=clone(source.baseline);return;}
    configuration.baseline.kind=kind as 'none'|'line';
    configuration.baseline.anchors=[];
  }else if(!isMulti(configuration)&&!isMulti(source)){
    if(kind===source.background.kind){configuration.background=clone(source.background);return;}
    configuration.background.kind=kind as 'none'|'line';
    configuration.background.low_level=null;
    configuration.background.high_level=null;
  }
}
function setBackgroundLevel(field:'low_level'|'high_level',event:Event){
  const input=event.target as HTMLInputElement;
  if(xpsBackground.value)xpsBackground.value[field]=input.value===''?null:input.valueAsNumber;
}
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
  <details class="panel scenario-comparison">
    <summary>方案敏感性比较 · 不修改主配置</summary>
    <div class="archive-section-body">
      <p class="hint">先保存当前拟合快照，再单独改变区间、背景或自由参数初值。每个替代方案使用原求解器；差异不是置信区间或系统误差完整估计，不自动按 AICc/BIC 排名。最多 8 个替代方案。</p>
      <div class="archive-action-row">
        <button type="button" :disabled="!snapshot||snapshot.stale||busy||working" @click="capture">{{base?'重新保存主方案并清空比较':'保存当前拟合为主方案'}}</button>
        <span v-if="!snapshot" class="hint">完成拟合后即可保存主方案。</span>
        <span v-else-if="snapshot.stale" class="hint">当前结果已过期，重新拟合后可保存。</span>
      </div>
      <p v-if="obsolete" class="warning" role="status">主工作区已改变：以下保存方案属于旧配置，不会覆盖当前工作。</p>
      <template v-if="base&&draft&&background">
        <fieldset class="scenario-settings" :disabled="working||busy">
          <legend>替代方案设置</legend>
          <div class="scenario-fields">
            <label>方案名称<input v-model="name" maxlength="120" /></label>
            <label>方案背景<select :value="background.kind" @change="backgroundChanged"><option v-if="originalBackground" :value="originalBackground.kind">沿用：{{originalBackground.kind}}</option><option v-if="originalBackground?.kind!=='none'" value="none">无背景</option><option v-if="originalBackground?.kind!=='line'" value="line">端点直线背景</option></select></label>
            <label>区间下限<input v-model.number="draft.range_start" type="number" step="any" /></label>
            <label>区间上限<input v-model.number="draft.range_end" type="number" step="any" /></label>
          </div>
          <div v-if="xpsBackground&&xpsBackground.kind!=='none'" class="scenario-endpoints">
            <div class="scenario-fields">
              <label>低能端水平<input :value="xpsBackground.low_level??''" type="number" step="any" @input="setBackgroundLevel('low_level',$event)" /></label>
              <label>高能端水平<input :value="xpsBackground.high_level??''" type="number" step="any" @input="setBackgroundLevel('high_level',$event)" /></label>
            </div>
            <p class="hint">水平留空时使用该端已保存的窗口；若没有窗口，请填写背景水平后预览。</p>
          </div>
          <details class="scenario-initials">
            <summary>调整自由参数初值（固定值和约束保持）</summary>
            <table class="archive-data-table scenario-initials-table" aria-label="方案初值">
              <thead><tr><th scope="col">峰</th><th scope="col">参数</th><th scope="col" class="archive-number">初值</th></tr></thead>
              <tbody>
                <template v-for="c in draft.components" :key="c.id">
                  <tr v-for="(p,key) in c.parameters" :key="String(key)">
                    <th scope="row">{{c.id}}</th><td>{{key}}</td>
                    <td class="archive-number"><input v-if="p" v-model.number="p.value" type="number" step="any"
                      :aria-label="`方案 ${c.id} ${key} 初值`" :disabled="p.fixed||draft.constraints.some(l=>l.target.component===c.id&&l.target.parameter===key)" /></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </details>
          <div class="archive-action-row"><button type="button" @click="inspect">预览方案背景</button></div>
        </fieldset>
        <BatchResultChart v-if="preview" :request="draft" :preview="preview" :result="null" selected-peak="" />
        <div class="archive-action-row scenario-solve-actions">
          <label v-if="preview" class="archive-check"><input v-model="confirmed" type="checkbox" :disabled="working" />已检查此方案区间与背景</label>
          <span v-else class="hint">预览并复核方案背景后可计算。</span>
          <button type="button" :disabled="working||busy||!preview||!confirmed||items.length>=8" @click="solve">{{working?'方案计算中…':'计算并保存替代方案'}}</button>
        </div>
        <p v-if="error" class="error" role="alert">{{error}}</p>
        <strong class="archive-section-label">方案结果比较</strong>
        <div class="archive-table-scroll" tabindex="0" role="region" aria-label="方案结果比较">
          <table class="archive-data-table scenario-result-table">
            <thead><tr><th scope="col">方案 / 峰</th><th scope="col">状态</th><th scope="col" class="archive-number">峰顶 / {{unit}}</th><th scope="col" class="archive-number">FWHM / {{unit}}</th><th scope="col" class="archive-number">区间面积</th><th scope="col" class="archive-number">全域面积</th></tr></thead>
            <tbody>
              <template v-for="item in comparison" :key="item.id">
                <tr v-if="!item.snapshot"><th scope="row">{{item.name}}</th><td colspan="5">{{item.error||'无结果'}}</td></tr>
                <tr v-for="p in item.snapshot?snapshotPeaks(item.snapshot):[]" :key="p.id">
                  <th scope="row">{{item.name}} / {{p.id}}</th>
                  <td>
                    <div v-if="item.snapshot" class="scenario-status">
                      <span>{{resultDiagnostics(item.snapshot.result).calculation}} · {{resultDiagnostics(item.snapshot.result).diagnostic}}</span>
                      <details v-if="resultDiagnostics(item.snapshot.result).warnings.length">
                        <summary>查看诊断</summary><p v-for="warning in resultDiagnostics(item.snapshot.result).warnings" :key="warning">{{warning}}</p>
                      </details>
                    </div>
                  </td>
                  <td class="archive-number">{{fmt(p.geometry?.peak_position)}}</td><td class="archive-number">{{fmt(p.geometry?.fwhm)}}</td>
                  <td class="archive-number">{{fmt(p.areaWindow)}}</td><td class="archive-number">{{fmt(p.areaTotal)}}</td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
        <p class="hint">面积单位 Y × {{unit}}。改变背景或观测点集后，统计指标不可直接当作同一目标函数比较；失败方案保留原因。临时方案不进入本地会话；刷新前可在下方导出比较摘要。</p>
        <AnalysisReportActions title="方案比较摘要 · 可打印 HTML" :entries="comparison.map(i=>({label:i.name,status:i.error||'已计算',snapshot:i.snapshot?{...i.snapshot,stale:obsolete}:null,note:'方案差异不是置信区间；区间或背景不同不进行 AICc/BIC 排名。'}))" :disabled="working||busy" />
      </template>
    </div>
  </details>
</template>
