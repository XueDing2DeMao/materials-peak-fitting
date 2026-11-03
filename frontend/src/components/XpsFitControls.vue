<script setup lang="ts">
import ParameterTabs, { type ParameterSection } from "./ParameterTabs.vue";
import PeakListEditor from './PeakListEditor.vue';
import { computed, nextTick, ref } from "vue";
import { addComponent, makeDoublet, changeComponentModel, requiredConfigVersion } from "../xpsState";
import { MODEL_GROUPS } from "../peakModels";
import type { XpsModel, Candidate, XpsPreview, XpsRequest } from "../xpsTypes";
const props=defineProps<{selectedPeak?:string;hasResult?:boolean;config:XpsRequest;previewed:boolean;backgroundPreview:XpsPreview|null;busy:boolean;candidates:Candidate[]}>();
const emit=defineEmits<{remove:[id:string];select:[id:string];preview:[];fit:[];candidates:[];error:[message:string];calibrate:[value:number]}>();
const manualBackgroundLevels=computed(()=>props.config.background.low_level!=null||props.config.background.high_level!=null);
const customBackgroundWindows=computed(()=>{
  const {range_start:lo,range_end:hi,background}=props.config,span=(hi-lo)*.03;
  return ([['low_window',[lo,lo+span]],['high_window',[hi-span,hi]]] as const).some(([key,expected])=>
    background[key]?.some((value,index)=>Math.abs(value-expected[index])>1e-9));
});
const fitBlockedMessage=computed(()=>props.busy?'正在处理数据，请稍候。':!props.config.x.length?'请先导入谱线并选择 X / Y 列。':!props.config.components.some(c=>c.enabled)?'请至少添加或启用一个峰。':props.config.background.kind==='shirley'&&!props.config.background.confirmed?(props.previewed?'请复核图中 Shirley 背景并勾选确认。':'请先预览并复核 Shirley 背景。'):'');
const split=ref(1), ratio=ref(.5), target=ref(""), source=ref(""), parameter=ref<"xc"|"A"|"w"|"h_low"|"h_high"|"sigma">("xc"), relationValue=ref(1);
function modelChanged(id:string,event:Event){const c=props.config.components.find(c=>c.id===id);if(!c)return;const select=event.target as HTMLSelectElement;try{changeComponentModel(props.config,c.id,select.value as XpsModel);}catch(e){select.value=c.model;emit("error",e instanceof Error?e.message:String(e));}}
function linked(id:string,name:string){return props.config.constraints.find(c=>c.target.component===id&&c.target.parameter===name);}
function unlink(id:string){props.config.constraints=props.config.constraints.filter(c=>c.target.component!==id&&c.source.component!==id);}
function addPair(){
  try{
    const firstNewIndex=props.config.components.length;
    makeDoublet(props.config,split.value,ratio.value,props.backgroundPreview);
    const added=props.config.components[firstNewIndex];
    if(added)emit('select',added.id);
  }catch(e){emit("error",String(e));}
}
function add(candidate?:Candidate){
  try{
    addComponent(props.config,candidate,props.backgroundPreview);
    const added=props.config.components.at(-1);
    if(added)emit('select',added.id);
  }catch(e){emit("error",String(e));}
}
function bind(){
  if(!source.value||!target.value||source.value===target.value){emit("error","请选择不同的来源峰和目标峰");return;}
  if(linked(target.value,parameter.value)){emit("error","目标参数已有绑定，请先解除");return;}
  props.config.constraints.push({target:{component:target.value,parameter:parameter.value},source:{component:source.value,parameter:parameter.value},kind:parameter.value==="xc"?"offset":"ratio",value:relationValue.value});
}
function resetWindows(){const c=props.config,w=(c.range_end-c.range_start)*.03;c.background.low_window=[c.range_start,c.range_start+w];c.background.high_window=[c.range_end-w,c.range_end];}
function level(event:Event,name:"low_level"|"high_level"){const value=(event.target as HTMLInputElement).value;props.config.background[name]=value===""?null:Number(value);}
const section=ref<ParameterSection>('range');
const peakList=ref<InstanceType<typeof PeakListEditor>|null>(null);
async function selectPeak(id:string,parameter?:string){section.value='peaks';peakList.value?.select(id);await nextTick();const row=Array.from(panel.value?.querySelectorAll<HTMLElement>('[data-peak-id]')??[]).find(row=>row.dataset.peakId===id);row?.scrollIntoView?.({block:'nearest'});row?.querySelector<HTMLButtonElement>('.peak-select')?.focus({preventScroll:true});if(parameter)void peakList.value?.focusParameter(id,parameter);}
const nextSection=computed<ParameterSection|null>(()=>props.busy||!props.config.x.length?null:!props.config.components.some(c=>c.enabled)?'peaks':props.config.background.kind==='shirley'&&!props.config.background.confirmed?'baseline':null);
async function goToNextStep(){if(!nextSection.value)return;section.value=nextSection.value;await nextTick();panel.value?.querySelector<HTMLElement>('.parameter-section:not([style*="display: none"]) button:not(:disabled), .parameter-section:not([style*="display: none"]) select:not(:disabled)')?.focus();}
const panel=ref<HTMLElement|null>(null);
const rangeStartInput=ref<HTMLInputElement|null>(null),rangeEndInput=ref<HTMLInputElement|null>(null);
async function focusRangeEndpoint(endpoint:'start'|'end'){section.value='range';await nextTick();const input=endpoint==='start'?rangeStartInput.value:rangeEndInput.value;input?.focus();input?.select();}
async function showSection(target:ParameterSection){section.value=target;await nextTick();panel.value?.querySelector<HTMLElement>('.parameter-section:not([style*="display: none"]) input:not(:disabled), .parameter-section:not([style*="display: none"]) select:not(:disabled), .parameter-section:not([style*="display: none"]) button:not(:disabled)')?.focus();}
defineExpose({showSection,selectPeak,focusRangeEndpoint});
</script>
<template>
  <section ref="panel" class="panel xps-controls">
    <div class="panel-title"><div><h2>XPS 拟合设置</h2></div></div>
    <ParameterTabs v-model="section" /><div class="settings-body">
<section v-show="section==='range'" class="parameter-section" aria-label="分析区间">
  <h3 class="workflow-section-title"><span>1</span>分析区间</h3>
    <div class="xps-two"><label>区间下限 / eV<input ref="rangeStartInput" v-model.number="config.range_start" data-test="xps-range-start" type="number" step="any" /></label><label>区间上限 / eV<input ref="rangeEndInput" v-model.number="config.range_end" type="number" step="any" /></label></div>
    <details class="settings-disclosure" :open="config.shift_eV!==0"><summary>能量校准 <span class="hint">{{config.shift_eV===0?'未偏移':`${config.shift_eV} eV`}}</span></summary>
    <label>能量偏移 / eV<input :value="config.shift_eV" type="number" step="any" @change="emit('calibrate',Number(($event.target as HTMLInputElement).value))" /></label>
    <label>校准依据<input v-model="config.calibration_note" placeholder="参考峰、参考值与依据" /></label>
    <p class="hint">校准能量 = 原始能量 + 偏移；区间、峰位与端点窗口同步平移。</p>
    </details>
    </section><section v-show="section==='baseline'" class="parameter-section baseline-form" aria-label="基线设置"><h3 class="workflow-section-title"><span>2</span>背景与复核</h3>
    <label>背景模型<select v-model="config.background.kind" data-test="xps-background"><option value="none">无背景</option><option value="line">直线</option><option value="shirley">静态 Shirley</option></select></label>
    <template v-if="config.background.kind!=='none'">
      <details class="settings-disclosure" data-test="xps-background-details" :open="manualBackgroundLevels||customBackgroundWindows"><summary>背景端点与窗口 <span class="hint">{{manualBackgroundLevels?'含手动水平':'窗口中位数'}}{{customBackgroundWindows?' · 自定义窗口':''}}</span></summary><p class="hint">端点水平留空时使用窗口中位数。</p>
      <button class="quiet-button" @click="resetWindows">窗口重置到区间两端</button>
      <div class="xps-two"><label>低能端水平<input :value="config.background.low_level??''" type="number" step="any" placeholder="窗口中位数" @input="level($event,'low_level')" /></label><label>高能端水平<input :value="config.background.high_level??''" type="number" step="any" placeholder="窗口中位数" @input="level($event,'high_level')" /></label></div>
      <div v-if="config.background.low_window" class="xps-two"><label>低端窗口起点<input v-model.number="config.background.low_window[0]" type="number" step="any" /></label><label>低端窗口终点<input v-model.number="config.background.low_window[1]" type="number" step="any" /></label></div>
      <div v-if="config.background.high_window" class="xps-two"><label>高端窗口起点<input v-model.number="config.background.high_window[0]" type="number" step="any" /></label><label>高端窗口终点<input v-model.number="config.background.high_window[1]" type="number" step="any" /></label></div>
      </details><details v-if="config.background.kind==='shirley'"><summary>Shirley 迭代设置</summary><div class="xps-two"><label>相对容差<input v-model.number="config.background.tolerance" type="number" step="any" /></label><label>最大迭代次数<input v-model.number="config.background.max_iterations" type="number" min="1" /></label></div></details>
    </template>
    <button type="button" class="baseline-preview" :disabled="busy||!config.x.length" @click="emit('preview')" data-test="xps-preview">预览背景</button>
    <div v-if="config.background.kind==='shirley'" class="confirmation-callout" :class="{'is-confirmed':config.background.confirmed,'is-unavailable':!previewed}">
      <strong class="confirmation-status">{{config.background.confirmed?'✓ 已确认':previewed?'! 拟合前请勾选确认':'① 请先预览背景'}}</strong>
      <label class="xps-check"><input v-model="config.background.confirmed" type="checkbox" :disabled="!previewed" data-test="xps-confirm" aria-describedby="xps-review-hint" />已复核当前 Shirley 背景</label>
      <p id="xps-review-hint" class="confirmation-hint">{{!previewed?'先预览，再检查背景并勾选。':config.background.confirmed?'修改背景后需重新复核。':'检查图中背景后勾选确认。'}}</p>
    </div>
    </section><section v-show="section==='peaks'" class="parameter-section" aria-label="峰参数">
    <PeakListEditor ref="peakList" :components="config.components" :constraints="config.constraints" :selected-peak="selectedPeak" unit="eV" :busy="busy" reversed :data-version="config.x" @select="emit('select',$event)" @remove="emit('remove',$event)" @unlink="unlink" @restored="config.schema_version=requiredConfigVersion(config)">
      <template #actions>
        <button type="button" @click="add()" :disabled="!config.x.length" data-test="xps-add">添加单峰</button>
        <button type="button" @click="emit('candidates')" :disabled="busy||!config.x.length">检测候选峰</button>
      </template>
      <template #candidates>
        <div v-if="candidates.length" class="xps-candidates" role="group" aria-label="点击候选峰添加初值"><p class="hint">点击候选峰添加初值。</p><button v-for="(c,i) in candidates" :key="i" @click="add(c)">{{ c.xc.toFixed(3) }} eV</button></div>
      </template>
      <template #identity="{component}"><label>显示标签<input v-model="component.label" /></label></template>
      <template #model="{component}"><label>峰形<select :value="component.model" :disabled="busy" @change="modelChanged(component.id,$event)"><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="model in group.models.filter(m=>m.id!=='psd_voigt2')" :key="model.id" :value="model.id">{{model.label}}</option></optgroup></select></label></template>
    </PeakListEditor>
    <details class="settings-disclosure peak-options" :open="config.groups.length>0"><summary>双峰组（{{config.groups.length}}）</summary>
    <div class="xps-two"><label>双峰间距 ΔE / eV<input v-model.number="split" type="number" step="any" /></label><label>第二峰 / 第一峰面积<input v-model.number="ratio" type="number" step="any" min="0.001" /></label></div>
    <button @click="addPair" :disabled="!config.x.length" data-test="xps-doublet">添加双峰组（同宽）</button>
    <p class="hint">间距与面积比需有依据；不自动判定化学态。</p>
    <div v-for="g in config.groups" :key="g.id" class="xps-group"><label>{{ g.id }} · {{ g.component_ids.join(' + ') }}<input v-model="g.label" aria-label="峰组标签" /></label></div>
    </details>
    <details class="xps-relations peak-options" :open="config.constraints.length>0"><summary>峰间约束（{{ config.constraints.length }}）</summary>
      <div v-for="(c,i) in config.constraints" :key="i" class="xps-relation"><span>{{ c.target.component }}.{{ c.target.parameter }} = {{ c.source.component }}.{{ c.source.parameter }} {{ c.kind==='offset'?'+':'×' }}</span><input v-model.number="c.value" type="number" step="any" :aria-label="`约束 ${i+1} 数值`" /><button class="quiet-button" @click="config.constraints.splice(i,1)" :aria-label="`删除约束 ${i+1}`">解除</button></div>
      <div class="xps-two"><label>来源峰<select v-model="source"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label><label>目标峰<select v-model="target"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label></div>
      <div class="xps-two"><label>关系<select v-model="parameter"><option value="xc">峰位偏移</option><option value="A">面积比例</option><option value="w">整体宽度 w 比例</option><option value="h_low">低 X 半宽比例</option><option value="h_high">高 X 半宽比例</option><option value="sigma">高斯核 σ 比例</option></select></label><label>关系数值<input v-model.number="relationValue" type="number" step="any" /></label></div><button @click="bind">添加约束</button>
    </details>
    <details class="peak-options"><summary>求解设置</summary><div class="xps-two"><label>最大函数评估次数<input v-model.number="config.solver.max_nfev" type="number" /></label><label>收敛阈值<input v-model.number="config.solver.tolerance" type="number" step="any" /></label></div></details>
    </section></div><div class="fit-primary-footer"><button v-if="nextSection" type="button" data-test="next-fit-step" class="next-step-action" @click="goToNextStep">{{nextSection==='peaks'?'前往峰设置':'前往背景复核'}}</button><span class="section-kicker">计算与复核</span><button class="primary" :disabled="Boolean(fitBlockedMessage)" :aria-describedby="fitBlockedMessage?'xps-fit-blocker':undefined" @click="emit('fit')" data-test="xps-fit">{{busy?'处理中…':hasResult?'重新拟合':'开始拟合'}}</button><p v-if="fitBlockedMessage" id="xps-fit-blocker" class="fit-blocker" role="status">{{fitBlockedMessage}}</p></div>
  </section>
</template>
