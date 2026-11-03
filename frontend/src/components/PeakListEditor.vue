<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import '../styles/peakSettings.css';
import PeakParameterEditor from './PeakParameterEditor.vue';
import { componentLine } from '../figureStyle';
import { PARAMETER_LABELS, type PeakParameterName } from '../peakModels';
import type { MultiComponent, MultiConstraint } from '../multipeakTypes';
import type { XpsParameter } from '../xpsTypes';

const props = defineProps<{
  components: MultiComponent[];
  constraints: MultiConstraint[];
  selectedPeak?: string;
  unit: string;
  busy: boolean;
  reversed?: boolean;
  dataVersion?: unknown;
}>();
const emit = defineEmits<{ select: [id: string]; remove: [id: string]; unlink: [id: string]; restored: [] }>();
const localSelection = ref(props.selectedPeak ?? '');
watch(() => props.selectedPeak, id => { if (id) localSelection.value = id; });
const selected = computed(() => props.components.find(c => c.id === localSelection.value) ?? props.components[0]);
const editors = ref<Record<string, InstanceType<typeof PeakParameterEditor> | null>>({});
const detailsButton = ref<HTMLButtonElement | null>(null);
const fieldHintId = useId();
const fieldOrder: PeakParameterName[] = ['xc', 'w', 'wG', 'wL', 'h_low', 'h_high', 'sigma', 'tau', 'A', 'mu'];
const fieldNames: Record<PeakParameterName, string> = {
  xc: '峰位', w: 'FWHM w', wG: '高斯 FWHM', wL: '洛伦兹 FWHM',
  h_low: '低 X 半宽', h_high: '高 X 半宽', sigma: '高斯核 σ', tau: '拖尾尺度 τ', A: '面积 A', mu: '混合系数 μ',
};
const fields = computed(() => Object.entries(selected.value?.parameters ?? {})
  .filter((entry): entry is [PeakParameterName, XpsParameter] => Boolean(entry[1]))
  .sort(([a], [b]) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b)));

function select(id: string) {
  localSelection.value = id;
  emit('select', id);
}
function linked(name: PeakParameterName) {
  return props.constraints.find(c => c.target.component === selected.value?.id && c.target.parameter === name);
}
function referenced(id: string) {
  return props.constraints.some(c => c.target.component === id || c.source.component === id);
}
function unitSuffix(name: PeakParameterName) {
  if (name === 'mu') return '';
  return name === 'A' ? ` / Y × ${props.unit}` : ` / ${props.unit}`;
}
async function focusParameter(id: string, parameter: string, trigger?: HTMLButtonElement | null) {
  select(id);
  await nextTick();
  await editors.value[id]?.focusParameter(parameter, trigger);
}
defineExpose({ focusParameter, select: (id: string) => { localSelection.value = id; } });
</script>

<template>
  <div class="peak-list-editor">
    <div v-if="$slots['shared-model']" class="peak-model-field"><slot name="shared-model" /></div>
    <header class="peak-list-toolbar">
      <h3>峰列表 <span class="peak-count">{{ components.length }}</span></h3>
      <div v-if="$slots.actions" class="peak-list-actions"><slot name="actions" /></div>
    </header>
    <slot name="candidates" />
    <div v-if="components.length" class="peak-list-table" :class="{'is-long':components.length > 5}">
      <div class="peak-list-heading" aria-hidden="true"><span>启用</span><span>峰</span><span class="peak-position-title">峰位 / {{ unit }}</span></div>
      <section v-for="c in components" :key="c.id" :data-peak-id="c.id" :aria-label="`${c.id} · ${c.label}`"
        class="peak-list-row" :class="{'is-selected': selected?.id === c.id}">
        <label class="peak-enabled"><input v-model="c.enabled" :disabled="busy" type="checkbox" :aria-label="`启用 ${c.id}`" /><span class="sr-only">启用此峰</span></label>
        <button class="peak-select" type="button" :aria-pressed="selected?.id === c.id" @click="select(c.id)" :title="`${c.id} · ${c.label}`">
          <span class="peak-color" :style="{background:componentLine(c.id).color}" aria-hidden="true" />
          <span class="peak-id">{{ c.id }}</span><span class="peak-label">{{ c.label }}</span>
        </button>
        <PeakParameterEditor :ref="el => {editors[c.id] = el as InstanceType<typeof PeakParameterEditor> | null}"
          compact :busy="busy" :component="c" :constraints="constraints" :unit="unit" :reversed="reversed" :data-version="dataVersion"
          @select="select(c.id)" @restored="emit('restored')">
          <template #identity><slot name="identity" :component="c" /></template>
        </PeakParameterEditor>
      </section>
    </div>
    <p v-else class="peak-list-empty">尚未添加峰。可在图上选峰，或使用上方添加按钮。</p>

    <section v-if="selected" class="selected-peak-editor" :aria-label="`${selected.id} 常用参数`">
      <header>
        <h3>参数初值 <span class="selected-id" :title="selected.label">{{ selected.id }}</span></h3>
        <button ref="detailsButton" type="button" class="peak-details-button" aria-haspopup="dialog" :disabled="busy" @click="focusParameter(selected.id, 'xc', detailsButton)">完整参数</button>
      </header>
      <div v-if="$slots.model" class="peak-model-field"><slot name="model" :component="selected" /></div>
      <div class="inline-peak-fields">
        <label v-for="[name, parameter] in fields" :key="name" :title="PARAMETER_LABELS[name] + unitSuffix(name)">
          <span>{{ fieldNames[name] }}<small>{{ unitSuffix(name) }}</small></span>
          <input v-model.number="parameter.value" type="number" step="any" :aria-label="`${selected.id} ${name} 快捷初值`"
            :aria-describedby="parameter.fixed || linked(name) ? fieldHintId + '-' + name : undefined"
            :disabled="busy || (Boolean(linked(name)) && !parameter.fixed)" />
          <small v-if="parameter.fixed" :id="fieldHintId + '-' + name">固定</small><small v-else-if="linked(name)" :id="fieldHintId + '-' + name">绑定至 {{ linked(name)?.source.component }}.{{ linked(name)?.source.parameter }}</small>
        </label>
      </div>
      <details :key="selected.id" class="peak-manage">
        <summary>管理 {{ selected.id }}</summary>
        <div class="peak-manage-actions">
          <button v-if="referenced(selected.id)" type="button" :disabled="busy" @click="emit('unlink', selected.id)">解除该峰的所有关联</button>
          <button type="button" :disabled="busy || referenced(selected.id)" @click="emit('remove', selected.id)">删除 {{ selected.id }}</button>
        </div>
      </details>
    </section>
  </div>
</template>

<style scoped>
.peak-list-editor {
  --peak-action-width: 26px;
  --peak-columns: 26px minmax(0,1fr) minmax(58px, 24%) var(--peak-action-width);
  display: grid;
  grid-template-columns: minmax(0,1fr);
  gap: var(--ui-space-2);
  margin: 0;
  min-width: 0;
}
.selected-peak-editor > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 8px;
}
.peak-list-toolbar { display: grid; gap: var(--ui-space-2); }
.peak-list-toolbar h3, .selected-peak-editor h3 {
  display: flex; align-items: center; gap: 6px;
  margin: 0; font-size: 13px; line-height: 1.45;
}
.peak-count, .selected-id { font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums; }
.peak-count { color: var(--ui-text-muted); }
.selected-id { color: var(--ui-primary); }
.peak-list-actions, .peak-manage-actions, .peak-list-editor :deep(.xps-candidates) {
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: var(--ui-space-2);
}
.peak-list-editor :deep(.xps-candidates > .hint) { grid-column: 1 / -1; margin: 0; }
.peak-list-actions :deep(button), .selected-peak-editor .peak-details-button, .peak-manage-actions button {
  min-height: var(--ui-control-height-compact); padding: 4px 8px; font-size: 12px; line-height: 1.4;
}
.peak-list-actions :deep(button), .peak-manage-actions button, .peak-list-editor :deep(.xps-candidates button) {
  width: 100%; margin: 0;
}
.peak-manage-actions button:only-child { grid-column: 1 / -1; }
.selected-peak-editor .peak-details-button {
  border-color: transparent; color: var(--ui-primary); background: transparent;
}
.selected-peak-editor .peak-details-button:hover:not(:disabled) {
  background: var(--ui-selected);
}
.peak-list-table.is-long { max-height: min(28dvh, 248px); overflow-y: auto; scroll-padding-top: 28px; }
.peak-list-heading, .peak-list-row {
  display: grid; grid-template-columns: var(--peak-columns); gap: 4px;
  align-items: center; padding-inline: 5px; border-bottom: 1px solid var(--ui-border);
}
.peak-list-heading {
  position: sticky; top: 0; z-index: 1; min-height: 28px;
  background: var(--ui-subtle); color: var(--ui-text-muted); font-size: 11px;
}
.peak-list-heading > :first-child { text-align: center; }
.peak-position-title { text-align: right; }
.peak-list-row { position: relative; min-height: 40px; }
.peak-list-row.is-selected { background: var(--ui-selected); box-shadow: inset 2px 0 var(--ui-primary); }
.peak-list-row .peak-enabled {
  display: grid; place-items: center; height: 32px; margin: 0; cursor: pointer;
}
.peak-enabled input { margin: 0; width: 16px; height: 16px; }
.peak-list-row .peak-select {
  display: flex; align-items: center; gap: 5px; min-width: 0; min-height: 32px; padding: 0;
  border: 0; background: transparent; text-align: left; font-size: 13px;
}
.peak-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.peak-id { flex: none; font-weight: 600; }
.peak-color { width: 7px; height: 7px; flex: none; border-radius: 50%; }
.peak-list-row :deep(.peak-parameter-overview.is-compact) {
  grid-column: 3 / 5; display: grid; grid-template-columns: minmax(0,1fr) var(--peak-action-width); gap: 4px;
}
.peak-list-row :deep(.peak-parameter-overview dl > div) { display: block; }
.peak-list-row :deep(.peak-parameter-overview dd) { position: relative; margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
/* 固定、绑定只注记峰位，数值始终和同行名称垂直居中。 */
.peak-list-row :deep(.peak-parameter-overview dd small) {
  position: absolute; inset-block-start: calc(100% - 1px); inset-inline-end: 0; line-height: 10px; white-space: nowrap;
}
.peak-list-row :deep(.peak-parameter-overview.is-compact > button) { width: 100%; min-height: 28px; padding: 0; }
.peak-list-empty { margin: 0; padding: 12px; background: var(--ui-subtle); color: var(--ui-text-muted); font-size: 12px; }
.selected-peak-editor { display: grid; gap: var(--ui-space-2); }
.peak-model-field :deep(label) {
  display: grid; grid-template-columns: minmax(0,1fr); gap: var(--ui-space-1);
  margin: 0; color: var(--ui-text-muted); font-size: 12px;
}
.peak-model-field :deep(select) { min-width: 0; width: 100%; }
.inline-peak-fields { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: var(--ui-space-1) var(--ui-space-2); }
.inline-peak-fields label {
  display: grid; grid-row: span 3; grid-template-rows: subgrid; align-content: start;
  min-width: 0; margin: 0; font-size: 12px;
}
.inline-peak-fields label > span { align-self: end; line-height: 1.5; overflow-wrap: anywhere; }
.inline-peak-fields small { color: var(--ui-text-muted); font-size: 11px; overflow-wrap: anywhere; }
.inline-peak-fields input { width: 100%; padding-inline: 8px; font-variant-numeric: tabular-nums; }
.peak-manage { margin: 0; }
.peak-manage-actions { margin-block: var(--ui-space-1); }
</style>
