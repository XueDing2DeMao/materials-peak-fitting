<script setup lang="ts">
import { computed, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { memorySnapshot } from '../useWorkProtection';
import { MODEL_GROUPS, PARAMETER_LABELS, PEAK_MODEL_PARAMETERS, peakModelInfo, type PeakParameterName } from '../peakModels';
import type { MultiComponent, MultiConstraint } from '../multipeakTypes';
import type { PeakModel } from '../types';
import type { XpsParameter } from '../xpsTypes';

const props=defineProps<{components:MultiComponent[];constraints:MultiConstraint[];model:PeakModel;unit:string;busy:boolean;error?:string;dataVersion?:unknown}>();
const emit=defineEmits<{model:[model:PeakModel];restore:[value:{components:MultiComponent[];constraints:MultiConstraint[];model:PeakModel}]}>();
let snapshot:ReturnType<typeof memorySnapshot<{components:MultiComponent[];constraints:MultiConstraint[];model:PeakModel}>>|null=null;
const canUndo=ref(false);
function undo(){const old=snapshot?.restore(props.dataVersion);if(!old)return;emit('restore',old);}
watch(()=>props.dataVersion,()=>{snapshot=null;canUndo.value=false;leave();});
const dialog=ref<HTMLDialogElement|null>(null),editorButton=ref<HTMLButtonElement|null>(null),isOpen=ref(false);
let restoreFocus=true;
const mixed=computed(()=>props.components.some(c=>c.model!==props.model));
const fields=computed(()=>[...new Set(props.components.flatMap(c=>PEAK_MODEL_PARAMETERS[c.model]))]);
function linked(id:string,name:PeakParameterName){return props.constraints.find(c=>c.target.component===id&&c.target.parameter===name);}
function label(name:PeakParameterName){return PARAMETER_LABELS[name]+(name==='mu'?'':name==='A'?` / Y × ${props.unit}`:` / ${props.unit}`);}
function bound(event:Event,p:XpsParameter,name:'lower'|'upper'){const value=(event.target as HTMLInputElement).value;p[name]=value===''?null:Number(value);}
function changeModel(event:Event){const select=event.target as HTMLSelectElement;emit('model',select.value as PeakModel);select.value=mixed.value?'':props.model;}
function open(){snapshot=memorySnapshot({components:props.components,constraints:props.constraints,model:props.model},props.dataVersion);canUndo.value=true;restoreFocus=true;dialog.value?.showModal();isOpen.value=true;}
function close(){dialog.value?.close();}
function closed(){isOpen.value=false;if(restoreFocus)editorButton.value?.focus();}
function leave(){restoreFocus=false;if(dialog.value?.open)close();}
onDeactivated(leave);onBeforeUnmount(leave);
</script>

<template>
  <button ref="editorButton" type="button" class="all-peaks-button" data-test="edit-all-peaks" aria-haspopup="dialog" :aria-expanded="isOpen" @click="open">统一调整峰参数（{{components.length}}）</button>
  <dialog ref="dialog" class="parameter-dialog all-peaks-dialog" aria-label="全部峰参数" @close="closed">
    <header class="parameter-dialog-header"><div><h2>全部峰参数</h2><p class="hint">{{components.length}} 个峰 · 同一峰函数，逐峰独立参数</p></div><button type="button" aria-label="关闭全部峰参数" @click="close">关闭</button></header>
    <div class="parameter-dialog-body">
      <label class="all-peaks-model">统一峰函数<select :value="mixed?'':model" :disabled="busy" data-test="all-peaks-model" @change="changeModel"><option v-if="mixed" value="" disabled>请选择统一峰函数</option><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="m in group.models" :key="m.id" :value="m.id">{{m.label}}</option></optgroup></select></label>
      <p v-if="error" class="error" role="alert">{{error}}</p>
      <p class="hint">上下限留空使用默认边界；固定参数不参与优化。</p>
      <details><summary>参数含义</summary><p class="hint">{{peakModelInfo(model)?.parameterMeaning}}</p></details>
      <p v-if="!components.length" class="hint">暂无峰，请返回工作区添加。</p>
      <div v-else class="all-peaks-table-scroll" tabindex="0" aria-label="全部峰参数表，可横向滚动">
        <table class="all-peaks-table">
          <thead><tr><th scope="col">峰 / 标签</th><th v-for="name in fields" :key="name" scope="col">{{label(name)}}</th></tr></thead>
          <tbody><tr v-for="c in components" :key="c.id" :class="{'peak-disabled':!c.enabled}">
            <th scope="row"><strong>{{c.id}}</strong><input v-model="c.label" type="text" :aria-label="`${c.id} 显示标签`" /><label class="xps-check"><input v-model="c.enabled" type="checkbox" :aria-label="`参数表启用 ${c.id}`" />启用</label><small v-if="mixed">{{peakModelInfo(c.model)?.label}}</small></th>
            <td v-for="name in fields" :key="name">
              <div v-if="c.parameters[name]" class="all-peaks-cell">
                <label>初值<input v-model.number="c.parameters[name]!.value" type="number" step="any" :aria-label="`${c.id} ${name} 初值`" :disabled="Boolean(linked(c.id,name))&&!c.parameters[name]!.fixed" /></label>
                <label>下限<input :value="c.parameters[name]!.lower??''" type="number" step="any" placeholder="自动" :aria-label="`${c.id} ${name} 下限`" @input="bound($event,c.parameters[name]!,'lower')" /></label>
                <label>上限<input :value="c.parameters[name]!.upper??''" type="number" step="any" placeholder="自动" :aria-label="`${c.id} ${name} 上限`" @input="bound($event,c.parameters[name]!,'upper')" /></label>
                <label class="all-peaks-fixed">固定<input v-model="c.parameters[name]!.fixed" type="checkbox" :aria-label="`${c.id} ${name} 固定`" /></label>
                <small v-if="linked(c.id,name)">绑定：{{linked(c.id,name)?.source.component}}.{{linked(c.id,name)?.source.parameter}} {{linked(c.id,name)?.kind==='offset'?'+':'×'}} {{linked(c.id,name)?.value}}</small>
              </div><span v-else>—</span>
            </td>
          </tr></tbody>
        </table>
      </div>
    </div>
    <footer class="parameter-dialog-footer"><p class="hint">修改即时生效；关闭或 Esc 保留修改。</p><button type="button" data-test="undo-parameters" :disabled="!canUndo||busy" @click="undo">撤销本次修改</button><button type="button" class="primary" @click="close">完成</button></footer>
  </dialog>
</template>

<style scoped>
.all-peaks-button { width: 100%; margin-block: 8px; }
.all-peaks-dialog { width: min(1400px,calc(100vw - 32px)); }
.all-peaks-dialog .parameter-dialog-header, .all-peaks-dialog .parameter-dialog-footer { padding: 12px 20px; }
.all-peaks-dialog .parameter-dialog-body { padding: 12px 20px; }
.all-peaks-dialog .parameter-dialog-body>p { margin-bottom: 8px; }
.all-peaks-model { display: flex; align-items: center; gap: 12px; margin: 0 0 8px; }
.all-peaks-model select { width: min(300px,70%); }
.all-peaks-dialog .parameter-dialog-body { display: flex; flex-direction: column; overflow: hidden; }
.all-peaks-dialog .parameter-dialog-body> :not(.all-peaks-table-scroll) { flex-shrink: 0; }
.all-peaks-table-scroll { overflow: auto; margin-top: 12px; min-height: 0; }
.all-peaks-table { width: 100%; border-collapse: collapse; }
.all-peaks-table th, .all-peaks-table td { padding: 8px; vertical-align: top; border: 1px solid var(--ui-border); }
.all-peaks-table thead th { position: sticky; top: 0; z-index: 1; background: var(--ui-subtle); text-align: left; font-size: var(--ui-caption); }
.all-peaks-table tbody th { min-width: 120px; width: 135px; font-weight: 400; }
.all-peaks-table tbody th>strong { display: inline-block; width: 25px; }
.all-peaks-table tbody th>input[type=text] { display: inline-block; width: calc(100% - 25px); margin-bottom: 5px; }
.all-peaks-table input:not([type=checkbox]) { height: 32px; min-width: 0; width: 100%; padding: 4px 6px; font-size: var(--ui-caption); }
.all-peaks-cell { min-width: 235px; display: grid; grid-template-columns: minmax(0,1.4fr) repeat(2,minmax(0,1fr)) 26px; gap: 4px; }
.all-peaks-cell>label { min-width: 0; margin: 0; font-size: var(--ui-caption); }
.all-peaks-cell .all-peaks-fixed { display: flex; flex-direction: column; align-items: center; gap: 10px; }
.all-peaks-cell>small { grid-column: 1 / -1; }
.all-peaks-table .xps-check { margin: 0; font-size: var(--ui-caption); }
.all-peaks-table small { display: block; font-size: var(--ui-caption); color: var(--ui-text-muted); }
.peak-disabled { background: var(--ui-subtle); }
</style>
