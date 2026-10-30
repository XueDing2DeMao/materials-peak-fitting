<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, watch } from 'vue';
import { memorySnapshot } from '../useWorkProtection';
import { PARAMETER_LABELS, peakModelInfo, type PeakParameterName } from '../peakModels';
import type { MultiComponent, MultiConstraint } from '../multipeakTypes';
import type { XpsParameter } from '../xpsTypes';

const props = defineProps<{ component: MultiComponent; constraints: MultiConstraint[]; unit: string; reversed?: boolean; dataVersion?:unknown }>();
const emit=defineEmits<{restored:[];select:[]}>();
let snapshot:ReturnType<typeof memorySnapshot<{component:MultiComponent;constraints:MultiConstraint[]}>>|null=null;
const canUndo=ref(false);
function undo(){const old=snapshot?.restore(props.dataVersion);if(!old)return;Object.assign(props.component,old.component);props.constraints.splice(0,props.constraints.length,...old.constraints);emit('restored');}
watch(()=>props.dataVersion,()=>{snapshot=null;canUndo.value=false;leave();});
const dialog = ref<HTMLDialogElement | null>(null);
const editorButton = ref<HTMLButtonElement | null>(null);
const isOpen = ref(false);
let restoreFocus = true;
const fields = computed(() => Object.entries(props.component.parameters).filter((entry): entry is [PeakParameterName, XpsParameter] => Boolean(entry[1])));
function linked(name: PeakParameterName) { return props.constraints.find(c => c.target.component === props.component.id && c.target.parameter === name); }
function label(name: PeakParameterName) { return PARAMETER_LABELS[name] + (name === 'mu' ? '' : name === 'A' ? ` / Y × ${props.unit}` : ` / ${props.unit}`); }
function format(value: number) { return Number.isFinite(value) ? Number(value.toPrecision(6)).toString() : '—'; }
function bound(event: Event, parameter: XpsParameter, name: 'lower' | 'upper') {
  const value = (event.target as HTMLInputElement).value;
  parameter[name] = value === '' ? null : Number(value);
}
function open() { emit('select');snapshot=memorySnapshot({component:props.component,constraints:props.constraints},props.dataVersion);canUndo.value=true;restoreFocus = true; dialog.value?.showModal(); isOpen.value = true; }
function close() { dialog.value?.close(); }
function closed() { isOpen.value = false; if (restoreFocus) editorButton.value?.focus(); }
function leave() { restoreFocus = false; if (dialog.value?.open) close(); }
onDeactivated(leave);
onBeforeUnmount(leave);
async function focusParameter(name:string){open();await nextTick();const inputs=Array.from(dialog.value?.querySelectorAll<HTMLInputElement>('input')??[]);const input=inputs.find(input=>!input.disabled&&input.getAttribute('aria-label')===`${props.component.id} ${name} 初值`)??inputs.find(input=>!input.disabled&&input.getAttribute('aria-label')===`${props.component.id} ${name} 下限`);input?.focus();input?.select();}
defineExpose({focusParameter});
</script>

<template>
  <section class="parameter-overview peak-parameter-overview" :aria-label="`${component.id} 参数摘要`">
    <dl v-if="component.parameters.xc"><div><dt :title="label('xc')">峰位</dt><dd>{{ format(component.parameters.xc.value) }}<small v-if="component.parameters.xc.fixed">固定</small><small v-else-if="linked('xc')">绑定</small></dd></div></dl>
    <button ref="editorButton" type="button" aria-haspopup="dialog" :aria-expanded="isOpen" :aria-label="`编辑 ${component.id} 参数与约束`" @click="open">参数</button>
  </section>
  <dialog ref="dialog" class="parameter-dialog peak-parameter-dialog" :aria-label="`${component.id} · ${component.label} 参数初值与约束`" @close="closed">
    <header class="parameter-dialog-header"><div><h2>{{ component.id }} · {{ component.label }}</h2><p class="hint">{{ peakModelInfo(component.model)?.label }} · 参数初值与约束</p></div><button type="button" aria-label="关闭参数编辑" @click="close">关闭</button></header>
    <div class="parameter-dialog-body">
      <div class="peak-identity"><slot name="identity" /></div>
      <p class="hint">上下限留空使用默认边界；固定参数不参与优化。</p>
      <details class="peak-parameter-help"><summary>参数含义</summary><p class="hint">{{ peakModelInfo(component.model)?.parameterMeaning }}<template v-if="reversed"> 横轴倒序不改变高 / 低 X 的定义。</template></p></details>
      <div class="parameter-editor-fields">
        <section v-for="[name, p] in fields" :key="name" class="parameter-row" role="group" :aria-label="label(name)">
          <strong class="parameter-name">{{ label(name) }}</strong>
          <label class="parameter-initial">初值<input v-model.number="p.value" type="number" step="any" :aria-label="`${component.id} ${name} 初值`" :disabled="Boolean(linked(name)) && !p.fixed" /></label>
          <label class="parameter-lower">下限<input :value="p.lower ?? ''" type="number" step="any" placeholder="自动" :aria-label="`${component.id} ${name} 下限`" @input="bound($event,p,'lower')" /></label>
          <label class="parameter-upper">上限<input :value="p.upper ?? ''" type="number" step="any" placeholder="自动" :aria-label="`${component.id} ${name} 上限`" @input="bound($event,p,'upper')" /></label>
          <label class="fixed-toggle"><input v-model="p.fixed" type="checkbox" :aria-label="`${component.id} ${name} 固定`" /><span>固定</span></label>
          <small v-if="linked(name)" class="peak-parameter-link">绑定：{{ linked(name)?.source.component }}.{{ linked(name)?.source.parameter }} {{ linked(name)?.kind === 'offset' ? '+' : '×' }} {{ linked(name)?.value }}</small>
        </section>
      </div>
    </div>
    <footer class="parameter-dialog-footer"><p class="hint">修改即时生效；关闭或 Esc 保留修改。</p><button type="button" data-test="undo-parameters" :disabled="!canUndo" @click="undo">撤销本次修改</button><button type="button" class="primary" @click="close">完成</button></footer>
  </dialog>
</template>

<style scoped>
.peak-parameter-overview { display: flex; align-items: center; gap: 8px; min-width: 0; margin: 0; padding: 0; border: 0; }
.peak-parameter-overview dl { flex: 1; min-width: 0; margin: 0; font-size: var(--ui-caption); }
.peak-parameter-overview dl>div { justify-content: flex-start; align-items: baseline; padding: 0; }
.peak-parameter-overview dt { font-weight: 400; color: var(--ui-text-muted); }
.peak-parameter-overview dd small { margin-left: 4px; }
.peak-parameter-overview>button { width: auto; flex-shrink: 0; height: var(--ui-control-height-compact); padding-inline: 10px; }
.peak-parameter-help { margin-bottom: var(--ui-space-4); }
.peak-parameter-link { grid-column: 1 / -1; color: var(--ui-text-muted); overflow-wrap: anywhere; }
.parameter-dialog-header h2 { overflow-wrap: anywhere; }
.peak-parameter-dialog .parameter-dialog-header, .peak-parameter-dialog .parameter-dialog-footer { padding: 12px 20px; }
.peak-parameter-dialog .parameter-dialog-body { padding: 12px 20px; }
.peak-parameter-dialog .parameter-dialog-body>p { margin-bottom: 8px; }
.peak-parameter-help { margin-bottom: 8px; }
.peak-identity { margin-bottom: 8px; }
.peak-identity :deep(label) { margin: 0; }
.peak-parameter-dialog .parameter-row { padding-block: 8px; gap: 8px; }
.peak-parameter-dialog .parameter-row input:not([type=checkbox]) { height: 34px; }
@media (min-width: 601px) {
  .peak-parameter-dialog .parameter-row { grid-template-columns: minmax(120px,1fr) repeat(3,minmax(0,1fr)) 48px; grid-template-areas: "name value lower upper fixed"; }
}
</style>
