<script setup lang="ts">
import { formatAxisValue, type AnalysisRange } from '../useAnalysisRange';
withDefaults(defineProps<{range:AnalysisRange|null|undefined;rangeEditing:boolean;selectionMode:boolean;readOnly?:boolean;variant?:'full'|'readout'|'actions';unit?:string}>(),{variant:'full',unit:''});
defineEmits<{edit:[];select:[]}>();
</script>
<template>
    <div v-if="variant==='readout'" class="spectrum-range" data-test="analysis-range-readout">
      <span>分析区间</span>
      <span v-if="range" class="spectrum-range-values">{{ formatAxisValue(range.start) }} – {{ formatAxisValue(range.end) }} {{unit}}</span>
      <span v-else>请选择有效分析区间</span>
    </div>
    <div v-else :class="variant==='full'?'analysis-range-toolbar':'spectrum-range-actions'">
      <template v-if="variant==='full'">
      <div v-if="range" data-test="analysis-range-readout" class="analysis-range-readout" aria-live="polite">
        <strong>分析区间</strong>
        <span class="range-start">起点 {{ formatAxisValue(range.start) }}</span>
        <span class="range-arrow" aria-hidden="true">→</span>
        <span class="range-end">终点 {{ formatAxisValue(range.end) }}</span>
      </div>
      <span v-else class="analysis-range-readout pending">请选择有效分析区间</span>
      <span v-if="range && rangeEditing" data-test="analysis-range-adjustment-hint" class="analysis-range-adjustment-hint">
        拖动边界调整区间，拖动上方箭头整体平移。
      </span>
      </template>
      <button v-if="!readOnly" data-test="range-edit-toggle" class="range-edit-button" type="button" :aria-pressed="rangeEditing" @click="$emit('edit')">
        <span v-if="variant==='full'" aria-hidden="true">↔</span>{{ rangeEditing ? "完成调整" : "调整范围" }}
      </button>
      <button v-if="!readOnly" data-test="range-selection-toggle" class="range-selection-button" type="button" :aria-pressed="selectionMode" @click="$emit('select')">
        <span v-if="variant==='full'" aria-hidden="true">⌗</span>{{ selectionMode ? "取消框选" : "框选分析区间" }}
      </button>
    </div>

</template>
<style scoped>
.spectrum-range{display:inline-flex;align-items:baseline;flex-wrap:wrap;gap:6px;color:var(--ui-text-muted)}
.spectrum-range-values{font-variant-numeric:tabular-nums;color:var(--ui-text)}
.spectrum-range-actions{display:grid;gap:2px}
</style>
