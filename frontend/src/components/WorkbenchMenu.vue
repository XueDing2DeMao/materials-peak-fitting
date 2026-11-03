<script setup lang="ts">
import { onBeforeUnmount, onDeactivated, ref } from 'vue';

const props = defineProps<{ label: string; alignEnd?: boolean; closeOnAction?: boolean }>();
const menu = ref<HTMLDetailsElement | null>(null);
const trigger = ref<HTMLElement | null>(null);

function close(restoreFocus = false) {
  if (!menu.value?.open) return;
  menu.value.open = false;
  if (restoreFocus) trigger.value?.focus();
}

function handleOutside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node)) close();
}

function watchOutside() {
  document.removeEventListener('pointerdown', handleOutside);
  if (menu.value?.open) document.addEventListener('pointerdown', handleOutside);
}

function handleFocusOut(event: FocusEvent) {
  if (event.relatedTarget instanceof Node && !menu.value?.contains(event.relatedTarget)) close();
}

function handleEscape(event: KeyboardEvent) {
  if (!menu.value?.open) return;
  event.stopPropagation();
  close(true);
}

function handleAction(event: MouseEvent) {
  if (props.closeOnAction && (event.target as Element).closest('button:enabled')) close(true);
}

onDeactivated(() => close());
onBeforeUnmount(() => document.removeEventListener('pointerdown', handleOutside));
</script>

<template>
  <details ref="menu" class="workbench-menu" @toggle="watchOutside" @focusout="handleFocusOut" @keydown.esc="handleEscape">
    <summary ref="trigger" class="workbench-command">{{ label }}<span class="menu-chevron" aria-hidden="true" /></summary>
    <div class="workbench-menu-body" :class="{'align-end': alignEnd}" @click="handleAction"><slot /></div>
  </details>
</template>

<style scoped>
.workbench-menu { position: relative; }
.workbench-menu > summary { list-style: none; cursor: pointer; }
.workbench-menu > summary::-webkit-details-marker { display: none; }
.menu-chevron { width: 7px; height: 7px; border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: translateY(-2px) rotate(45deg); }
.workbench-menu[open] > summary { border-color: var(--ui-border-strong); background: var(--ui-subtle); }
.workbench-menu[open] .menu-chevron { transform: translateY(2px) rotate(225deg); }
.workbench-menu-body { position: absolute; z-index: 40; inset-block-start: calc(100% + 6px); inset-inline-start: 0; width: max-content; max-width: calc(100vw - 40px); padding: 8px; background: var(--ui-surface); border: 1px solid var(--ui-border); border-radius: var(--ui-panel-radius); box-shadow: 0 4px 16px #172b4620; }
.align-end { inset-inline-start: auto; inset-inline-end: 0; }
</style>
