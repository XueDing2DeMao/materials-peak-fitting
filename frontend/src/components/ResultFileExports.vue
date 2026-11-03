<script setup lang="ts">
import { ref, watch } from 'vue';

const props = defineProps<{ result: object }>();
const details = ref<HTMLDetailsElement | null>(null);
const summary = ref<HTMLElement | null>(null);

function close(returnFocus = false) {
  if (!details.value?.open) return;
  details.value.open = false;
  if (returnFocus) summary.value?.focus({ preventScroll: true });
}

function onAction(event: MouseEvent) {
  if ((event.target as Element).closest('button:enabled')) close(true);
}

function onEscape(event: KeyboardEvent) {
  if (!details.value?.open) return;
  event.stopPropagation();
  close(true);
}

watch(() => props.result, () => close());
</script>

<template>
  <details ref="details" class="fit-file-exports" data-result-section="archive" data-test="result-export-menu" @keydown.esc="onEscape">
    <summary ref="summary">导出拟合结果</summary>
    <slot name="hint" />
    <div class="fit-file-actions export-actions" @click="onAction"><slot /></div>
  </details>
</template>

<style scoped>
.fit-file-exports { min-width: 0; border-top: 1px solid var(--ui-border); }
.fit-file-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
  gap: var(--ui-space-2);
  padding: var(--ui-space-1) 0 var(--ui-space-2);
}
.fit-file-actions :deep(button) {
  width: 100%; min-width: 0; height: auto; min-height: var(--ui-control-height-compact);
  padding: 4px var(--ui-space-2); white-space: normal; font-size: 13px;
}
</style>
