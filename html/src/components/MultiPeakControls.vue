<script setup lang="ts">
import AllPeakParameterEditor from './AllPeakParameterEditor.vue';
import { suggestBaselineAnchors } from '../baselineSuggestions';
import { computed, ref } from 'vue';
import { addMultiComponent, changeAllMultiModels, removeMultiComponent, validateMulti, clone } from '../multipeakState';
import { MODEL_GROUPS, peakModelInfo, type PeakParameterName } from '../peakModels';
import type { PeakModel } from '../types';
import type { MultiRequest, MultiPreview } from '../multipeakTypes';
import type { Candidate } from '../xpsTypes';
const props=defineProps<{unified?:boolean;model?:PeakModel;config:MultiRequest;preview:MultiPreview|null;busy:boolean;candidates:Candidate[]}>();
const emit=defineEmits<{preview:[];fit:[];candidates:[];error:[message:string];model:[model:PeakModel]}>();
const selectedModel=ref<PeakModel>(props.config.components[0]?.model??'gaussian'),modelError=ref('');
const sharedModel=computed(()=>props.model??selectedModel.value);
const mixedModels=computed(()=>props.config.components.some(c=>c.model!==sharedModel.value));
const target=ref(''),source=ref(''),parameter=ref<PeakParameterName>('xc'),relationValue=ref(1);
const unit=()=>props.config.analysis_mode==='xrd'?'°':'X 单位';
function formatCenter(value:unknown){return typeof value==='number'&&Number.isFinite(value)?Number(value.toPrecision(6)).toString():'—';}
const baselineNeedsReview=computed(()=>props.config.baseline.kind!=='none'&&!props.config.baseline.confirmed);
const fitBlockedMessage=computed(()=>{
  if(props.busy)return '正在处理数据，请稍候。';
  if(!props.config.x.length)return '请先导入谱线并选择 X / Y 列。';
  if(!props.config.components.some(c=>c.enabled))return '请至少添加或启用一个峰。';
  if(mixedModels.value)return '请在“统一峰函数”中选择一种峰函数。';
  if(baselineNeedsReview.value)return props.preview
    ? '请复核图中基线，确认后开始拟合。'
    : '请先点击“预览基线”，检查后勾选确认。';
  return '';
});
function suggestAnchors(){
  const c=props.config,b=c.baseline,count=b.kind==='constant'?1:b.kind==='line'?2:b.kind==='polynomial'?b.degree+2:b.kind==='spline'?4:6;
  b.anchors=suggestBaselineAnchors(c.x,c.y,c.range_start,c.range_end,count);b.confirmed=false;
}
function report(fn:()=>void){try{fn();}catch(e){emit('error',e instanceof Error?e.message:String(e));}}
function referenced(id:string){return props.config.constraints.some(c=>c.target.component===id||c.source.component===id);}
function unlink(id:string){props.config.constraints=props.config.constraints.filter(c=>c.source.component!==id&&c.target.component!==id);}
function modelChanged(model:PeakModel){
  modelError.value='';
  try{changeAllMultiModels(props.config,model);selectedModel.value=model;emit('model',model);}
  catch(e){modelError.value=e instanceof Error?e.message:String(e);emit('error',modelError.value);}
}
function selectModel(event:Event){const select=event.target as HTMLSelectElement;modelChanged(select.value as PeakModel);select.value=mixedModels.value?'':sharedModel.value;}
function restoreParameters(value:{components:MultiRequest['components'];constraints:MultiRequest['constraints'];model:PeakModel}){
  props.config.components=value.components;props.config.constraints=value.constraints;selectedModel.value=value.model;modelError.value='';emit('model',value.model);emit('error','');
}
function add(candidate?:Candidate){report(()=>{addMultiComponent(props.config,candidate,props.preview,sharedModel.value);});}
function bind(){report(()=>{
  if(!source.value||!target.value||source.value===target.value)throw new Error('请选择不同的来源峰和目标峰');
  const next=clone(props.config);next.constraints.push({source:{component:source.value,parameter:parameter.value},target:{component:target.value,parameter:parameter.value},kind:parameter.value==='xc'?'offset':'ratio',value:relationValue.value});validateMulti(next);props.config.constraints=next.constraints;
});}
const rangeStartInput=ref<HTMLInputElement|null>(null),rangeEndInput=ref<HTMLInputElement|null>(null);
function focusRangeEndpoint(endpoint:'start'|'end'){const input=endpoint==='start'?rangeStartInput.value:rangeEndInput.value;input?.focus();input?.select();}
defineExpose({focusRangeEndpoint});
</script>
<template><section class="panel xps-controls"><div class="panel-title"><h2>{{unified?'峰拟合设置':'多峰拟合设置'}}</h2></div>
  <div class="settings-body">
  <h3 class="workflow-section-title"><span>1</span>分析区间</h3>
  <div class="xps-two"><label>区间下限 / {{unit()}}<input ref="rangeStartInput" v-model.number="config.range_start" type="number" step="any" data-test="multi-range-start" /></label><label>区间上限 / {{unit()}}<input ref="rangeEndInput" v-model.number="config.range_end" data-test="multi-range-end" type="number" step="any" /></label></div>
  <h3 class="workflow-section-title"><span>2</span>基线与复核</h3><label>基线模型<select v-model="config.baseline.kind" data-test="multi-baseline"><option value="none">无基线</option><option value="constant">常数</option><option value="line">直线</option><option value="polynomial">多项式</option><option value="spline">Spline</option><option value="bspline">B-Spline</option></select></label>
  <template v-if="config.baseline.kind!=='none'"><details class="ui-help"><summary>基线设置说明</summary><p>常数／直线未填锚点时，使用区间两端各 5% 数据的中位数。其他模型需设置足够锚点。</p></details>
  <div v-for="(a,i) in config.baseline.anchors" :key="i" class="xps-two"><label>锚点 {{i+1}} X<input v-model.number="a.x" type="number" step="any" /></label><label>Y<input v-model.number="a.y" type="number" step="any" /></label><button @click="config.baseline.anchors.splice(i,1)">删除锚点 {{i+1}}</button></div>
  <div class="xps-actions"><button @click="config.baseline.anchors.push({x:config.range_start,y:0})">添加基线锚点</button><button @click="suggestAnchors" :disabled="busy||!config.x.length">生成建议锚点</button><button v-if="config.baseline.anchors.length" @click="config.baseline.anchors=[]">清空锚点</button></div>
  <label v-if="config.baseline.kind==='polynomial'">多项式阶数<input v-model.number="config.baseline.degree" type="number" min="1" max="8" /></label>
  <label v-if="config.baseline.kind==='bspline'">平滑系数<input v-model.number="config.baseline.smoothing" type="number" min="0" step="any" /></label>
  </template><button :disabled="busy||!config.x.length" @click="emit('preview')" data-test="multi-preview">预览基线</button>
  <div v-if="config.baseline.kind!=='none'" class="confirmation-callout" :class="{'is-confirmed':config.baseline.confirmed,'is-unavailable':!preview}">
    <strong class="confirmation-status">{{config.baseline.confirmed?'✓ 已确认':preview?'! 拟合前请勾选确认':'① 请先预览基线'}}</strong>
    <label class="xps-check"><input v-model="config.baseline.confirmed" type="checkbox" :disabled="busy||!preview" data-test="multi-confirm" aria-describedby="multi-review-hint" />已复核当前基线</label>
    <p id="multi-review-hint" class="confirmation-hint">{{!preview?'先预览，再检查图中基线并勾选。':config.baseline.confirmed?'修改区间或基线后需重新复核。':'检查图中基线后勾选确认。'}}</p>
  </div>
  <h3 class="workflow-section-title"><span>3</span>峰与参数</h3><div class="xps-actions"><button @click="add()" :disabled="!config.x.length||config.components.length>=40" data-test="multi-add">添加峰</button><button @click="emit('candidates')" :disabled="busy||!config.x.length">检测候选峰</button></div>
  <p v-if="!config.components.length" class="hint">点击“图上添加峰”选峰，或“添加峰”从区间最高点建立初值。</p>
  <label>统一峰函数<select :value="mixedModels?'':sharedModel" :disabled="busy" data-test="multi-model" @change="selectModel"><option v-if="mixedModels" value="" disabled>请选择统一峰函数</option><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="m in group.models" :key="m.id" :value="m.id">{{m.label}}</option></optgroup></select></label>
  <p v-if="modelError" class="error" role="alert">{{modelError}}</p>
  <AllPeakParameterEditor :data-version="config.x" :components="config.components" :constraints="config.constraints" :model="sharedModel" :unit="unit()" :busy="busy" :error="modelError" @model="modelChanged" @restore="restoreParameters" />
  <div v-if="candidates.length" class="xps-candidates"><button v-for="(c,i) in candidates" :key="i" @click="add(c)">{{c.xc.toFixed(3)}} {{unit()}}</button></div>
    <section v-for="c in config.components" :key="c.id" class="xps-peak peak-card" :aria-label="`${c.id} · ${c.label}`">
      <div class="peak-card-heading"><label class="xps-check"><input v-model="c.enabled" type="checkbox" :aria-label="`启用 ${c.id}`" /><span class="sr-only">启用此峰</span></label><strong :title="`${c.id} · ${c.label}`">{{c.id}} · {{c.label}}</strong><small class="peak-card-model" :title="peakModelInfo(c.model)?.label">{{peakModelInfo(c.model)?.label}}</small></div>
      <p class="hint" :aria-label="`${c.id} 参数摘要`">峰位 {{formatCenter(c.parameters.xc?.value)}} <span v-if="c.parameters.xc?.fixed">固定</span></p>
      <div class="peak-card-actions"><button class="quiet-button" :disabled="referenced(c.id)" @click="removeMultiComponent(config,c.id)">删除 {{ c.id }}</button></div>
      <button v-if="referenced(c.id)" class="quiet-button peak-card-unlink" @click="unlink(c.id)">解除该峰的所有关联</button>
    </section>
    <details v-if="!unified||config.components.length>1||config.constraints.length" class="xps-relations" :open="config.constraints.length>0"><summary>峰间约束（{{ config.constraints.length }}）</summary>
      <div v-for="(c,i) in config.constraints" :key="i" class="xps-relation"><span>{{ c.target.component }}.{{ c.target.parameter }} = {{ c.source.component }}.{{ c.source.parameter }} {{ c.kind==='offset'?'+':'×' }}</span><input v-model.number="c.value" type="number" step="any" :aria-label="`约束 ${i+1} 数值`" /><button class="quiet-button" @click="config.constraints.splice(i,1)" :aria-label="`删除约束 ${i+1}`">解除</button></div>
      <div class="xps-two"><label>来源峰<select v-model="source"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label><label>目标峰<select v-model="target"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label></div>
      <div class="xps-two"><label>关系<select v-model="parameter"><option value="xc">峰位偏移</option><option value="A">面积比例</option><option value="w">整体宽度 w 比例</option><option value="wG">Gaussian 宽度比例</option><option value="wL">Lorentzian 宽度比例</option><option value="h_low">低 X 半宽比例</option><option value="h_high">高 X 半宽比例</option><option value="sigma">高斯核 σ 比例</option></select></label><label>关系数值<input v-model.number="relationValue" type="number" step="any" /></label></div><button @click="bind">添加约束</button>
    </details>
  <slot name="single-tools" />
  <details><summary>求解设置</summary><slot name="solver" /><div class="xps-two"><label>最大函数评估次数<input v-model.number="config.solver.max_nfev" type="number" min="1" max="20000" /></label><label>收敛阈值<input v-model.number="config.solver.tolerance" type="number" step="any" /></label></div></details>
  </div><div class="fit-primary-footer"><span class="section-kicker">计算与复核</span>
    <button class="primary" :disabled="Boolean(fitBlockedMessage)" :aria-describedby="fitBlockedMessage?'multi-fit-blocker':undefined" @click="emit('fit')" data-test="multi-fit">{{busy?'处理中…':unified?'开始拟合':'拟合全部启用峰'}}</button>
    <p v-if="fitBlockedMessage" id="multi-fit-blocker" class="fit-blocker" role="status" data-test="multi-fit-blocker">{{fitBlockedMessage}}</p>
    <div v-if="!busy&&config.x.length&&config.components.some(c=>c.enabled)&&baselineNeedsReview" class="xps-actions">
      <button v-if="!preview" type="button" data-test="multi-preview-next" @click="emit('preview')">预览基线</button>
      <button v-else type="button" class="confirmation-action" data-test="multi-confirm-next" @click="config.baseline.confirmed=true">复核无误，确认基线</button>
    </div>
  </div>
</section></template>
