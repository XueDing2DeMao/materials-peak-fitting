<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import AnalysisRangeToolbar from './AnalysisRangeToolbar.vue';
import type { AnalysisRange } from '../useAnalysisRange';

type EditMode = 'browse' | 'range' | 'select' | 'peak' | 'anchor' | 'moveAnchor';
const props = defineProps<{
  title: string;
  displayMode: 'focus' | 'full';
  mode: EditMode;
  range: AnalysisRange | null | undefined;
  unit: string;
  hasData: boolean;
  peakCaption?: string;
  readOnly?: boolean;
  canAddAnchors?: boolean;
  canEditAnchors?: boolean;
  anchorPosition?: string;
}>();
const emit = defineEmits<{
  display: [mode:'focus'|'full']; reset: []; editRange: []; selectRange: [];
  addPeak: []; addAnchor: []; editAnchors: []; browse: [];
}>();
const instruction = {
  browse: null,
  range: { label: '调整分析区间', hint: '拖动两端调整范围，拖动上方箭头平移区间。' },
  select: { label: '框选分析区间', hint: '水平拖动，松开后更新区间。' },
  peak: { label: '添加峰', hint: '左键添加峰，右键点击峰位标记删除。' },
  anchor: { label: '添加基线锚点', hint: '点击谱线添加锚点，完成后预览并复核基线。' },
  moveAnchor: { label: '编辑基线锚点', hint: '拖动编号调整位置，单击编号精确编辑。' },
};
const active = computed(() => props.readOnly ? null : instruction[props.mode]);
const open = ref(false);
const menuHost = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const panelId = useId();

function close(returnFocus = false) {
  open.value = false;
  if (returnFocus) void nextTick(() => trigger.value?.focus());
}
function onAction(event: MouseEvent) {
  if ((event.target as Element).closest('button')) close(true);
}
function onOutside(event: PointerEvent) {
  if (open.value && !menuHost.value?.contains(event.target as Node)) close();
}
function onFocusOut(event: FocusEvent) {
  if (!menuHost.value?.contains(event.relatedTarget as Node | null)) close();
}
function onEscape(event: KeyboardEvent) {
  if (!open.value) return;
  event.stopPropagation();
  event.preventDefault();
  close(true);
}
function finishEditing() {
  emit('browse');
  void nextTick(() => trigger.value?.focus());
}
onMounted(() => document.addEventListener('pointerdown', onOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true));
</script>

<template>
  <header class="spectrum-command">
    <div class="spectrum-command-line">
      <h2>{{title}}</h2>
      <div class="spectrum-command-actions">
        <div class="spectrum-view-choice" role="group" aria-label="谱线显示范围">
          <button type="button" :aria-pressed="displayMode==='focus'" aria-label="聚焦拟合区间" data-test="spectrum-focus" @click="emit('display','focus')">拟合区间</button>
          <button type="button" :aria-pressed="displayMode==='full'" aria-label="全谱视图" data-test="spectrum-full" @click="emit('display','full')">全谱</button>
        </div>
        <div ref="menuHost" class="spectrum-menu-host" @keydown.esc="onEscape" @focusout="onFocusOut">
          <button ref="trigger" type="button" class="spectrum-menu-trigger" data-test="spectrum-tools"
            :aria-controls="panelId" :aria-expanded="open" @click="open=!open">{{readOnly?'视图工具':'编辑工具'}}<span aria-hidden="true" class="spectrum-chevron"></span></button>
          <div v-show="open" :id="panelId" class="spectrum-menu" role="group" aria-label="图谱工具" @click="onAction">
            <template v-if="!readOnly">
              <template v-if="hasData">
                <span class="spectrum-menu-label">分析区间</span>
                <AnalysisRangeToolbar variant="actions" :range="range" :range-editing="mode==='range'" :selection-mode="mode==='select'"
                  @edit="emit('editRange')" @select="emit('selectRange')" />
              </template>
              <span class="spectrum-menu-label">峰与基线</span>
              <button type="button" :aria-pressed="mode==='peak'" :disabled="!hasData" data-test="chart-add-peak" @click="emit('addPeak')">{{mode==='peak'?'取消添加峰':'图上添加峰'}}</button>
              <button v-if="canAddAnchors" type="button" :aria-pressed="mode==='anchor'" @click="emit('addAnchor')">{{mode==='anchor'?'取消添加锚点':'图上添加基线锚点'}}</button>
              <button v-if="canEditAnchors" type="button" :aria-pressed="mode==='moveAnchor'" data-test="chart-edit-anchors" @click="emit('editAnchors')">{{mode==='moveAnchor'?'结束锚点编辑':'图上编辑锚点'}}</button>
            </template>
            <button type="button" class="spectrum-reset-action" data-test="spectrum-reset" @click="emit('reset')">复位图谱视图</button>
          </div>
        </div>
      </div>
    </div>
    <div v-if="hasData" class="spectrum-meta">
      <AnalysisRangeToolbar variant="readout" :range="range" :range-editing="false" :selection-mode="false" :unit="unit" />
      <span v-if="peakCaption" class="spectrum-caption" data-test="peak-marker-caption">{{peakCaption}}</span>
    </div>
    <div v-if="active" class="spectrum-edit-status">
      <span class="spectrum-edit-guide" role="status">
        <strong>{{active.label}}</strong>
        <span :data-test="mode==='select'?'range-selection-guide':mode==='range'?'analysis-range-adjustment-hint':undefined">{{active.hint}}</span>
        <span v-if="anchorPosition">{{anchorPosition}}</span>
      </span>
      <button type="button" data-test="chart-browse" @click="finishEditing">结束编辑 <kbd>Esc</kbd></button>
    </div>
  </header>
</template>

<style scoped>
.spectrum-command{display:grid;gap:5px;flex:none;min-width:0}
.spectrum-command-line,.spectrum-command-actions,.spectrum-view-choice,.spectrum-menu-trigger,.spectrum-meta,.spectrum-edit-status,.spectrum-edit-guide{display:flex;align-items:center}
.spectrum-command-line{justify-content:space-between;flex-wrap:wrap;gap:6px 12px}
.spectrum-command h2{font-size:15px;line-height:1.4;margin:0}
.spectrum-command-actions{gap:8px;flex-wrap:wrap}
.spectrum-command button{min-height:30px;height:auto;padding:4px 9px;font-size:12px;line-height:1.4;white-space:nowrap}
.spectrum-view-choice{padding:2px;gap:2px;background:var(--ui-subtle);border:1px solid var(--ui-border);border-radius:var(--ui-control-radius)}
.spectrum-view-choice button{min-height:25px;border:none;background:transparent;color:var(--ui-text-muted)}
.spectrum-view-choice button[aria-pressed=true]{background:var(--ui-selected);color:var(--ui-primary);font-weight:600}
.spectrum-menu-host{position:relative}
.spectrum-menu-trigger{gap:8px}
.spectrum-chevron{width:6px;height:6px;border:solid currentColor;border-width:0 1.5px 1.5px 0;transform:translateY(-1px) rotate(45deg)}
.spectrum-menu-trigger[aria-expanded=true] .spectrum-chevron{transform:translateY(2px) rotate(225deg)}
.spectrum-menu{position:absolute;z-index:35;top:calc(100% + 4px);right:0;width:max-content;min-width:172px;max-height:min(300px,55dvh);overflow:auto;display:grid;gap:2px;padding:6px;background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:var(--ui-panel-radius);box-shadow:var(--ui-shadow)}
.spectrum-menu-label{font-size:11px;color:var(--ui-text-muted);padding:4px 8px 0}
.spectrum-menu :deep(button){display:flex;align-items:center;justify-content:flex-start;width:100%;min-height:30px;height:auto;padding:5px 8px;border:0;background:transparent;color:var(--ui-text);text-align:left;font-size:13px;font-weight:400}
.spectrum-menu :deep(button:hover:not(:disabled)),.spectrum-menu :deep(button:focus-visible),.spectrum-menu :deep(button[aria-pressed=true]){background:var(--ui-selected);color:var(--ui-primary)}
.spectrum-menu .spectrum-reset-action:not(:first-child){margin-top:3px;border-top:1px solid var(--ui-border);border-radius:0}
.spectrum-meta,.spectrum-edit-guide{flex-wrap:wrap;gap:4px 12px;font-size:12px;line-height:1.5;color:var(--ui-text-muted)}
.spectrum-caption{padding-left:12px;border-left:1px solid var(--ui-border)}
.spectrum-edit-status{flex-wrap:wrap;justify-content:space-between;gap:4px 12px;background:var(--ui-selected);border-left:2px solid var(--ui-primary);padding:3px 8px}
.spectrum-edit-guide strong{color:var(--ui-primary);font-weight:600}
.spectrum-edit-status button{border:0;background:transparent;color:var(--ui-primary);font-weight:600;padding-inline:4px}
.spectrum-edit-status kbd{font:inherit;font-weight:400;color:var(--ui-text-muted)}
@media(pointer:coarse){.spectrum-command button,.spectrum-menu :deep(button){min-height:44px}}
</style>
