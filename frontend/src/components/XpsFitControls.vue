<script setup lang="ts">
import { ref } from "vue";
import { addComponent, makeDoublet, removeComponent, changeComponentModel } from "../xpsState";
import { MODEL_GROUPS, PARAMETER_LABELS, peakModelInfo } from "../peakModels";
import type { XpsModel, Candidate, ParamName, XpsComponent, XpsPreview, XpsRequest } from "../xpsTypes";
const props=defineProps<{config:XpsRequest;previewed:boolean;backgroundPreview:XpsPreview|null;busy:boolean;candidates:Candidate[]}>();
const emit=defineEmits<{preview:[];fit:[];candidates:[];error:[message:string];calibrate:[value:number]}>();
const split=ref(1), ratio=ref(.5), target=ref(""), source=ref(""), parameter=ref<"xc"|"A"|"w"|"h_low"|"h_high"|"sigma">("xc"), relationValue=ref(1);
const paramLabels=Object.fromEntries(Object.entries(PARAMETER_LABELS).map(([k,v])=>[k,v+(k==='mu'?'':k==='A'?' / Y × eV':' / eV')])) as Record<ParamName,string>;
function modelChanged(c:XpsComponent,event:Event){const select=event.target as HTMLSelectElement;try{changeComponentModel(props.config,c.id,select.value as XpsModel);}catch(e){select.value=c.model;emit("error",e instanceof Error?e.message:String(e));}}
function linked(id:string,name:string){return props.config.constraints.find(c=>c.target.component===id&&c.target.parameter===name);}
function referenced(id:string){return props.config.constraints.some(c=>c.target.component===id||c.source.component===id);}
function unlink(id:string){props.config.constraints=props.config.constraints.filter(c=>c.target.component!==id&&c.source.component!==id);}
function addPair(){try{makeDoublet(props.config,split.value,ratio.value,props.backgroundPreview);}catch(e){emit("error",String(e));}}
function add(candidate?:Candidate){try{addComponent(props.config,candidate,props.backgroundPreview);}catch(e){emit("error",String(e));}}
function bind(){
  if(!source.value||!target.value||source.value===target.value){emit("error","请选择不同的来源峰和目标峰");return;}
  if(linked(target.value,parameter.value)){emit("error","目标参数已有绑定，请先解除");return;}
  props.config.constraints.push({target:{component:target.value,parameter:parameter.value},source:{component:source.value,parameter:parameter.value},kind:parameter.value==="xc"?"offset":"ratio",value:relationValue.value});
}
function resetWindows(){const c=props.config,w=(c.range_end-c.range_start)*.03;c.background.low_window=[c.range_start,c.range_start+w];c.background.high_window=[c.range_end-w,c.range_end];}
function bound(event:Event,p:{lower?:number|null;upper?:number|null},name:"lower"|"upper"){const value=(event.target as HTMLInputElement).value;p[name]=value===""?null:Number(value);}
function level(event:Event,name:"low_level"|"high_level"){const value=(event.target as HTMLInputElement).value;props.config.background[name]=value===""?null:Number(value);}
</script>
<template>
  <section class="panel xps-controls">
    <div class="panel-title"><div><h2>XPS 拟合设置</h2><p>结合能 · 面积归一化多峰 · 固定背景</p></div></div>
    <h3>能区与校准</h3>
    <div class="xps-two"><label>区间下限 / eV<input v-model.number="config.range_start" data-test="xps-range-start" type="number" step="any" /></label><label>区间上限 / eV<input v-model.number="config.range_end" type="number" step="any" /></label></div>
    <label>能量偏移 / eV<input :value="config.shift_eV" type="number" step="any" @change="emit('calibrate',Number(($event.target as HTMLInputElement).value))" /></label>
    <label>校准依据<input v-model="config.calibration_note" placeholder="参考峰、参考值与依据" /></label>
    <p class="hint">校准能量 = 原始能量 + 偏移。区间、峰位和端点窗口均使用校准能量；改偏移时同步平移。</p>
    <h3>固定背景</h3>
    <label>背景模型<select v-model="config.background.kind" data-test="xps-background"><option value="none">无背景</option><option value="line">直线</option><option value="shirley">静态 Shirley</option></select></label>
    <template v-if="config.background.kind!=='none'">
      <p class="hint">空白水平值使用窗口中位数；手工水平值优先。窗口按低能端 / 高能端命名。</p>
      <button class="quiet-button" @click="resetWindows">窗口重置到区间两端</button>
      <div class="xps-two"><label>低能端水平<input :value="config.background.low_level??''" type="number" step="any" placeholder="窗口中位数" @input="level($event,'low_level')" /></label><label>高能端水平<input :value="config.background.high_level??''" type="number" step="any" placeholder="窗口中位数" @input="level($event,'high_level')" /></label></div>
      <div v-if="config.background.low_window" class="xps-two"><label>低端窗口起点<input v-model.number="config.background.low_window[0]" type="number" step="any" /></label><label>低端窗口终点<input v-model.number="config.background.low_window[1]" type="number" step="any" /></label></div>
      <div v-if="config.background.high_window" class="xps-two"><label>高端窗口起点<input v-model.number="config.background.high_window[0]" type="number" step="any" /></label><label>高端窗口终点<input v-model.number="config.background.high_window[1]" type="number" step="any" /></label></div>
      <details v-if="config.background.kind==='shirley'"><summary>Shirley 迭代设置</summary><div class="xps-two"><label>相对容差<input v-model.number="config.background.tolerance" type="number" step="any" /></label><label>最大迭代次数<input v-model.number="config.background.max_iterations" type="number" min="1" /></label></div></details>
    </template>
    <button :disabled="busy||!config.x.length" @click="emit('preview')" data-test="xps-preview">预览背景</button>
    <label v-if="config.background.kind==='shirley'" class="xps-check"><input v-model="config.background.confirmed" type="checkbox" :disabled="!previewed" data-test="xps-confirm" />已复核当前 Shirley 背景</label>
    <h3>峰与双峰组</h3>
    <div class="xps-actions"><button @click="add()" :disabled="!config.x.length" data-test="xps-add">添加单峰</button><button @click="emit('candidates')" :disabled="busy||!config.x.length">检测候选峰</button></div>
    <div v-if="candidates.length" class="xps-candidates"><p class="hint">候选仅为初值；点击选择需要的峰。</p><button v-for="(c,i) in candidates" :key="i" @click="add(c)">{{ c.xc.toFixed(3) }} eV</button></div>
    <div class="xps-two"><label>双峰间距 ΔE / eV<input v-model.number="split" type="number" step="any" /></label><label>第二峰 / 第一峰面积<input v-model.number="ratio" type="number" step="any" min="0.001" /></label></div>
    <button @click="addPair" :disabled="!config.x.length" data-test="xps-doublet">添加双峰组（同宽）</button>
    <p class="hint">间距和面积比须按谱线依据设置；不会自动判定元素或化学态。</p>
    <div v-for="g in config.groups" :key="g.id" class="xps-group"><label>{{ g.id }} · {{ g.component_ids.join(' + ') }}<input v-model="g.label" aria-label="峰组标签" /></label></div>
    <details v-for="c in config.components" :key="c.id" class="xps-peak" open>
      <summary>{{ c.id }} · {{ c.label }} <span v-if="!c.enabled">（停用）</span></summary>
      <div class="xps-two"><label>显示标签<input v-model="c.label" /></label><label>峰形<select :value="c.model" @change="modelChanged(c,$event)"><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="model in group.models.filter(m=>m.id!=='psd_voigt2')" :key="model.id" :value="model.id">{{model.label}}</option></optgroup></select></label></div>
      <p class="hint">{{peakModelInfo(c.model)?.parameterMeaning}} XPS 横轴倒序显示不改变高 / 低 X 的定义。</p>
      <label class="xps-check"><input v-model="c.enabled" type="checkbox" />启用此峰</label>
      <div class="xps-param-head"><span>参数 / 初值</span><span>下界</span><span>上界</span><span>固定</span></div>
      <div v-for="(p,name) in c.parameters" :key="name" class="xps-param">
        <label>{{ paramLabels[name] }}<input v-if="p" v-model.number="p.value" type="number" step="any" :aria-label="`${c.id} ${name} 初值`" :disabled="Boolean(linked(c.id,name))&&!p.fixed" /></label>
        <input v-if="p" :value="p.lower??''" type="number" step="any" :aria-label="`${c.id} ${name} 下界`" @input="bound($event,p,'lower')" />
        <input v-if="p" :value="p.upper??''" type="number" step="any" :aria-label="`${c.id} ${name} 上界`" @input="bound($event,p,'upper')" />
        <input v-if="p" v-model="p.fixed" type="checkbox" :aria-label="`${c.id} ${name} 固定`" />
        <small v-if="linked(c.id,name)" class="xps-link-note">绑定：{{ linked(c.id,name)?.source.component }}.{{ name }} {{ linked(c.id,name)?.kind==='offset'?'+':'×' }} {{ linked(c.id,name)?.value }}</small>
      </div>
      <div class="xps-actions"><button v-if="referenced(c.id)" class="quiet-button" @click="unlink(c.id)">解除该峰的所有关联</button><button class="quiet-button" :disabled="referenced(c.id)" @click="removeComponent(config,c.id)">删除 {{ c.id }}</button></div>
    </details>
    <details class="xps-relations" open><summary>峰间约束（{{ config.constraints.length }}）</summary>
      <div v-for="(c,i) in config.constraints" :key="i" class="xps-relation"><span>{{ c.target.component }}.{{ c.target.parameter }} = {{ c.source.component }}.{{ c.source.parameter }} {{ c.kind==='offset'?'+':'×' }}</span><input v-model.number="c.value" type="number" step="any" :aria-label="`约束 ${i+1} 数值`" /><button class="quiet-button" @click="config.constraints.splice(i,1)" :aria-label="`删除约束 ${i+1}`">解除</button></div>
      <div class="xps-two"><label>来源峰<select v-model="source"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label><label>目标峰<select v-model="target"><option value="">请选择</option><option v-for="c in config.components" :key="c.id" :value="c.id">{{ c.id }} · {{ c.label }}</option></select></label></div>
      <div class="xps-two"><label>关系<select v-model="parameter"><option value="xc">峰位偏移</option><option value="A">面积比例</option><option value="w">整体宽度 w 比例</option><option value="h_low">低 X 半宽比例</option><option value="h_high">高 X 半宽比例</option><option value="sigma">高斯核 σ 比例</option></select></label><label>关系数值<input v-model.number="relationValue" type="number" step="any" /></label></div><button @click="bind">添加约束</button>
    </details>
    <details><summary>求解设置</summary><div class="xps-two"><label>最大求值次数<input v-model.number="config.solver.max_nfev" type="number" /></label><label>求解容差<input v-model.number="config.solver.tolerance" type="number" step="any" /></label></div></details>
    <div class="fit-primary-footer"><button class="primary" :disabled="busy||!config.components.some(c=>c.enabled)||!config.x.length||(config.background.kind==='shirley'&&!config.background.confirmed)" @click="emit('fit')" data-test="xps-fit">{{busy?'正在计算…':'联合拟合全部启用峰'}}</button></div>
  </section>
</template>
