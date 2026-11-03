<script setup lang="ts">
import { spectrumUnits } from "../spectrumUnits";
import ParameterTabs, { type ParameterSection } from "./ParameterTabs.vue";
import PeakListEditor from "./PeakListEditor.vue";
import AllPeakParameterEditor from './AllPeakParameterEditor.vue';
import { suggestBaselineAnchors } from '../baselineSuggestions';
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { addMultiComponent, changeAllMultiModels, validateMulti, clone } from '../multipeakState';
import { MODEL_GROUPS, type PeakParameterName } from '../peakModels';
import type { PeakModel } from '../types';
import type { MultiRequest, MultiPreview } from '../multipeakTypes';
import type { Candidate } from '../xpsTypes';
const props=defineProps<{selectedPeak?:string;hasResult?:boolean;unified?:boolean;model?:PeakModel;config:MultiRequest;preview:MultiPreview|null;busy:boolean;candidates:Candidate[]}>();
const emit=defineEmits<{remove:[id:string];select:[id:string];preview:[];fit:[];candidates:[];error:[message:string];model:[model:PeakModel]}>();
const selectedModel=ref<PeakModel>(props.config.components[0]?.model??'gaussian'),modelError=ref('');
const sharedModel=computed(()=>props.model??selectedModel.value);
const mixedModels=computed(()=>props.config.components.some(c=>c.model!==sharedModel.value));
const target=ref(''),source=ref(''),parameter=ref<PeakParameterName>('xc'),relationValue=ref(1);
const unit=()=>spectrumUnits(props.config.analysis_mode,props.config.source).x;
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
function add(candidate?:Candidate){
  report(()=>{
    addMultiComponent(props.config,candidate,props.preview,sharedModel.value);
    const added=props.config.components.at(-1);
    if(added)emit('select',added.id);
  });
}
function bind(){report(()=>{
  if(!source.value||!target.value||source.value===target.value)throw new Error('请选择不同的来源峰和目标峰');
  const next=clone(props.config);next.constraints.push({source:{component:source.value,parameter:parameter.value},target:{component:target.value,parameter:parameter.value},kind:parameter.value==='xc'?'offset':'ratio',value:relationValue.value});validateMulti(next);props.config.constraints=next.constraints;
});}
const section=ref<ParameterSection>('range');
const peakList=ref<InstanceType<typeof PeakListEditor>|null>(null);
async function selectPeak(id:string,parameter?:string){section.value='peaks';peakList.value?.select(id);await nextTick();const row=Array.from(panel.value?.querySelectorAll<HTMLElement>('[data-peak-id]')??[]).find(row=>row.dataset.peakId===id);row?.scrollIntoView?.({block:'nearest'});row?.querySelector<HTMLButtonElement>('.peak-select')?.focus({preventScroll:true});if(parameter)void peakList.value?.focusParameter(id,parameter);}
const nextSection=computed<ParameterSection|null>(()=>props.busy||!props.config.x.length?null:!props.config.components.some(c=>c.enabled)?'peaks':baselineNeedsReview.value?'baseline':mixedModels.value?'peaks':null);
async function goToNextStep(){if(!nextSection.value)return;section.value=nextSection.value;await nextTick();panel.value?.querySelector<HTMLElement>('.parameter-section:not([style*="display: none"]) button:not(:disabled), .parameter-section:not([style*="display: none"]) select:not(:disabled)')?.focus();}
const panel=ref<HTMLElement|null>(null);
const rangeStartInput=ref<HTMLInputElement|null>(null),rangeEndInput=ref<HTMLInputElement|null>(null);
const anchorDialog=ref<HTMLDialogElement|null>(null),anchorButton=ref<HTMLButtonElement|null>(null),anchorsOpen=ref(false);
let anchorSnapshot:MultiRequest['baseline']['anchors']|null=null,restoreAnchorFocus=true;
async function openAnchors(index?:number){if(props.busy)return;anchorSnapshot=props.config.baseline.anchors.map(a=>({...a}));restoreAnchorFocus=true;anchorDialog.value?.showModal();anchorsOpen.value=true;await nextTick();if(index!==undefined){const input=anchorDialog.value?.querySelector<HTMLInputElement>(`[aria-label="锚点 ${index+1} X"]`);input?.focus();input?.select();}}
function closeAnchors(){anchorDialog.value?.close();}
function anchorsClosed(){anchorsOpen.value=false;anchorSnapshot=null;if(restoreAnchorFocus)anchorButton.value?.focus({preventScroll:true});}
function undoAnchors(){if(anchorSnapshot)props.config.baseline.anchors=anchorSnapshot.map(a=>({...a}));}
function leaveAnchors(){restoreAnchorFocus=false;anchorSnapshot=null;if(anchorDialog.value?.open)closeAnchors();anchorsOpen.value=false;}
watch(()=>[props.config,props.config.x,props.config.baseline.kind],leaveAnchors);
onDeactivated(leaveAnchors);onBeforeUnmount(leaveAnchors);
async function focusRangeEndpoint(endpoint:'start'|'end'){section.value='range';await nextTick();const input=endpoint==='start'?rangeStartInput.value:rangeEndInput.value;input?.focus();input?.select();}
async function showSection(target:ParameterSection){section.value=target;await nextTick();panel.value?.querySelector<HTMLElement>('.parameter-section:not([style*="display: none"]) input:not(:disabled), .parameter-section:not([style*="display: none"]) select:not(:disabled), .parameter-section:not([style*="display: none"]) button:not(:disabled)')?.focus();}
defineExpose({showSection,selectPeak,focusRangeEndpoint,openAnchors});
</script>
<template><section ref="panel" class="panel xps-controls"><div class="panel-title"><h2>{{unified?'峰拟合设置':'多峰拟合设置'}}</h2></div>
  <ParameterTabs v-model="section" /><div class="settings-body">
<section v-show="section==='range'" class="parameter-section" aria-label="分析区间">
  <h3 class="workflow-section-title"><span>1</span>分析区间</h3>
  <div class="xps-two"><label>区间下限 / {{unit()}}<input ref="rangeStartInput" v-model.number="config.range_start" type="number" step="any" data-test="multi-range-start" /></label><label>区间上限 / {{unit()}}<input ref="rangeEndInput" v-model.number="config.range_end" data-test="multi-range-end" type="number" step="any" /></label></div>
  </section><section v-show="section==='baseline'" class="parameter-section baseline-form" aria-label="基线设置"><h3 class="workflow-section-title"><span>2</span>基线与复核</h3><label>基线模型<select v-model="config.baseline.kind" data-test="multi-baseline"><option value="none">无基线</option><option value="constant">常数</option><option value="line">直线</option><option value="polynomial">多项式</option><option value="spline">Spline</option><option value="bspline">B-Spline</option></select></label>
  <template v-if="config.baseline.kind!=='none'"><details class="ui-help"><summary>基线设置说明</summary><p>常数／直线未填锚点时，使用区间两端各 5% 数据的中位数。其他模型需设置足够锚点。</p></details>
  <div class="baseline-anchor-actions">
    <button ref="anchorButton" type="button" aria-haspopup="dialog" :aria-expanded="anchorsOpen" :disabled="busy" data-test="edit-baseline-anchors" @click="openAnchors()">编辑锚点 <span class="anchor-count">{{config.baseline.anchors.length}}</span></button>
    <button type="button" @click="suggestAnchors" :disabled="busy||!config.x.length">生成建议锚点</button>
  </div>
  <label v-if="config.baseline.kind==='polynomial'">多项式阶数<input v-model.number="config.baseline.degree" type="number" min="1" max="8" /></label>
  <label v-if="config.baseline.kind==='bspline'">平滑系数<input v-model.number="config.baseline.smoothing" type="number" min="0" step="any" /></label>
  </template><button type="button" class="baseline-preview" :disabled="busy||!config.x.length" @click="emit('preview')" data-test="multi-preview">预览基线</button>
  <div v-if="config.baseline.kind!=='none'" class="confirmation-callout" :class="{'is-confirmed':config.baseline.confirmed,'is-unavailable':!preview}">
    <strong class="confirmation-status">{{config.baseline.confirmed?'✓ 已确认':preview?'! 拟合前请勾选确认':'① 请先预览基线'}}</strong>
    <label class="xps-check"><input v-model="config.baseline.confirmed" type="checkbox" :disabled="busy||!preview" data-test="multi-confirm" aria-describedby="multi-review-hint" />已复核当前基线</label>
    <p id="multi-review-hint" class="confirmation-hint">{{!preview?'先预览，再检查图中基线并勾选。':config.baseline.confirmed?'修改区间或基线后需重新复核。':'检查图中基线后勾选确认。'}}</p>
  </div>
  </section><section v-show="section==='peaks'" class="parameter-section" aria-label="峰参数">
    <PeakListEditor ref="peakList" :components="config.components" :constraints="config.constraints" :selected-peak="selectedPeak" :unit="unit()" :busy="busy" :data-version="config.x" @select="emit('select',$event)" @remove="emit('remove',$event)" @unlink="unlink">
      <template #shared-model>
        <label>统一峰函数<select :value="mixedModels?'':sharedModel" :disabled="busy" data-test="multi-model" @change="selectModel"><option v-if="mixedModels" value="" disabled>请选择统一峰函数</option><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="m in group.models" :key="m.id" :value="m.id">{{m.label}}</option></optgroup></select></label>
        <p v-if="modelError" class="error" role="alert">{{modelError}}</p>
      </template>
      <template #actions>
        <button type="button" @click="add()" :disabled="!config.x.length||config.components.length>=40" data-test="multi-add">添加峰</button>
        <button type="button" @click="emit('candidates')" :disabled="busy||!config.x.length">检测候选峰</button>
      </template>
      <template #candidates>
        <div v-if="candidates.length" class="xps-candidates" role="group" aria-label="点击候选峰添加初值"><button v-for="(c,i) in candidates" :key="i" @click="add(c)">{{c.xc.toFixed(3)}} {{unit()}}</button></div>
      </template>
      <template #identity="{component}"><label>显示标签<input v-model="component.label" /></label></template>
    </PeakListEditor>
    <div class="peak-tools-secondary"><AllPeakParameterEditor :data-version="config.x" :components="config.components" :constraints="config.constraints" :model="sharedModel" :unit="unit()" :busy="busy" :error="modelError" @model="modelChanged" @restore="restoreParameters" /></div>

    <details v-if="!unified||config.components.length>1||config.constraints.length" class="xps-relations peak-options" :open="config.constraints.length>0"><summary>峰间约束（{{ config.constraints.length }}）</summary>
      <div v-for="(c,i) in config.constraints" :key="i" class="xps-relation"><span>{{ c.target.component }}.{{ c.target.parameter }} = {{ c.source.component }}.{{ c.source.parameter }} {{ c.kind==='offset'?'+':'×' }}</span><input v-model.number="c.value" type="number" step="any" :aria-label="`约束 ${i+1} 数值`" /><button class="quiet-button" @click="config.constraints.splice(i,1)" :aria-label="`删除约束 ${i+1}`">解除</button></div>
      <div class="xps-two"><label>来源峰<select v-model="source"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label><label>目标峰<select v-model="target"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label></div>
      <div class="xps-two"><label>关系<select v-model="parameter"><option value="xc">峰位偏移</option><option value="A">面积比例</option><option value="w">整体宽度 w 比例</option><option value="wG">Gaussian 宽度比例</option><option value="wL">Lorentzian 宽度比例</option><option value="h_low">低 X 半宽比例</option><option value="h_high">高 X 半宽比例</option><option value="sigma">高斯核 σ 比例</option></select></label><label>关系数值<input v-model.number="relationValue" type="number" step="any" /></label></div><button @click="bind">添加约束</button>
    </details>
  <div v-if="$slots['single-tools']" class="peak-single-tools"><slot name="single-tools" /></div>
  <details class="peak-options"><summary>求解设置</summary><slot name="solver" /><div class="xps-two"><label>最大函数评估次数<input v-model.number="config.solver.max_nfev" type="number" min="1" max="20000" /></label><label>收敛阈值<input v-model.number="config.solver.tolerance" type="number" step="any" /></label></div></details>
  </section></div><div class="fit-primary-footer"><button v-if="nextSection" type="button" data-test="next-fit-step" class="next-step-action" @click="goToNextStep">{{nextSection==='peaks'?'前往峰设置':'前往背景复核'}}</button><span class="section-kicker">计算与复核</span>
    <button class="primary" :disabled="Boolean(fitBlockedMessage)" :aria-describedby="fitBlockedMessage?'multi-fit-blocker':undefined" @click="emit('fit')" data-test="multi-fit">{{busy?'处理中…':hasResult?'重新拟合':unified?'开始拟合':'拟合全部启用峰'}}</button>
    <p v-if="fitBlockedMessage" id="multi-fit-blocker" class="fit-blocker" role="status" data-test="multi-fit-blocker">{{fitBlockedMessage}}</p>

  </div>
  <dialog ref="anchorDialog" class="parameter-dialog baseline-anchor-dialog" aria-label="基线锚点" data-test="baseline-anchor-dialog" @cancel.prevent="closeAnchors" @close="anchorsClosed">
    <header class="parameter-dialog-header"><div><h2>基线锚点</h2><p class="hint">{{config.baseline.anchors.length}} 个锚点 · 编号对应图中标记</p></div><button type="button" aria-label="关闭基线锚点" @click="closeAnchors">关闭</button></header>
    <div class="parameter-dialog-body">
      <div class="xps-actions"><button type="button" :disabled="busy" @click="config.baseline.anchors.push({x:config.range_start,y:0})">添加基线锚点</button><button type="button" :disabled="busy||!config.baseline.anchors.length" @click="config.baseline.anchors=[]">清空锚点</button></div>
      <div v-if="config.baseline.anchors.length" class="baseline-anchor-editor">
        <div class="anchor-grid-head" aria-hidden="true"><span>#</span><span>X / {{unit()}}</span><span>Y / 原数据单位</span><span>删除</span></div>
        <div v-for="(a,i) in config.baseline.anchors" :key="i" class="anchor-row">
          <span class="anchor-number" aria-hidden="true">{{i+1}}</span>
          <input v-model.number="a.x" :disabled="busy" :aria-label="`锚点 ${i+1} X`" type="number" step="any" />
          <input v-model.number="a.y" :disabled="busy" :aria-label="`锚点 ${i+1} Y`" type="number" step="any" />
          <button type="button" :disabled="busy" :aria-label="`删除锚点 ${i+1}`" :title="`删除锚点 ${i+1}`" @click="config.baseline.anchors.splice(i,1)">×</button>
        </div>
      </div>
      <p v-else class="hint">暂无锚点。可手动添加、生成建议，或关闭弹窗后在图上选点。</p>
    </div>
    <footer class="parameter-dialog-footer"><p class="hint">修改即时生效；关闭或 Esc 保留修改。修改后需重新预览并复核基线。</p><button type="button" :disabled="busy" data-test="undo-baseline-anchors" @click="undoAnchors">撤销本次修改</button><button type="button" class="primary" @click="closeAnchors">完成</button></footer>
  </dialog>
</section></template>

<style scoped>
.peak-tools-secondary :deep(.all-peaks-button) { width: 100%; margin: 0; min-height: var(--ui-control-height-compact); height: auto; padding: 4px 6px; border-color: transparent; background: transparent; color: var(--ui-primary); font-size: 12px; }
</style>
