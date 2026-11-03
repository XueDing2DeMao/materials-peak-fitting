<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';

const props=defineProps<{archiveLabel?:string;workstation?:boolean}>();
const id = useId();
const views = [
  { id: 'results', label: props.workstation?'结果概览':'峰结果' },
  ...(props.workstation?[{id:'parameters',label:'完整参数'} as const]:[]),
  { id: 'diagnostics', label: '诊断详情' },
  { id: 'archive', label: props.archiveLabel??'比较与归档' },
] as const;
const view = ref<typeof views[number]['id']>('results');
const tabs = ref<HTMLButtonElement[]>([]);
const panel = ref<HTMLElement | null>(null);

watch(view, () => {
  if (props.workstation && panel.value) panel.value.scrollTop = 0;
}, { flush: 'post' });

async function navigate(event: KeyboardEvent, index: number) {
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
    : event.key === 'ArrowRight' ? (index + 1) % views.length
      : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : null;
  if (target === null) return;
  event.preventDefault();
  view.value = views[target].id;
  await nextTick();
  tabs.value[target]?.focus();
}

defineExpose({ showDiagnostics: () => { view.value = 'diagnostics'; }, showResults: () => { view.value = 'results'; }, showArchive: () => { view.value = 'archive'; } });
</script>

<template>
  <section class="result-workspace" :data-result-view="view" :class="{'single-result-workspace':workstation}" aria-label="结果与复核">
    <div class="result-view-header">
    <div class="result-view-tabs" role="tablist" aria-label="结果视图">
      <button v-for="(item,index) in views" :key="item.id" ref="tabs" type="button"
        :id="`${id}-${item.id}`" role="tab" :aria-selected="view===item.id"
        :aria-controls="`${id}-content`" :tabindex="view===item.id?0:-1"
        :data-test="`result-view-${item.id}`" @click="view=item.id" @keydown="navigate($event,index)">{{item.label}}</button>
    </div>
      <div v-if="$slots.tools" class="result-view-tools"><slot name="tools" /></div>
    </div>
    <div ref="panel" :id="`${id}-content`" role="tabpanel" :aria-labelledby="`${id}-${view}`">
      <!-- 内容保持挂载，切换视图不丢失参数弹窗、比较设置及归档备注。 -->
      <slot />
      <div v-show="view==='archive'" class="result-archive-content"><slot name="archive" /></div>
    </div>
  </section>
</template>

<style scoped>
.result-workspace{min-width:0;border:1px solid var(--ui-border);border-radius:var(--ui-panel-radius);background:var(--ui-surface);overflow:clip}
.result-view-header{display:flex;align-items:center;flex:none;border-bottom:1px solid var(--ui-border);background:var(--ui-subtle)}
.result-view-tabs{display:flex;flex:1;min-width:0;flex-wrap:wrap;gap:12px;padding:6px 14px;background:var(--ui-subtle)}
.result-view-tabs button{border-color:transparent;background:transparent;color:var(--ui-text-muted);height:32px;padding:4px 6px}
.result-view-tabs button[aria-selected=true]{background:transparent;border-color:transparent;border-bottom-color:var(--ui-primary);border-radius:0;color:var(--ui-primary);font-weight:600}
.result-view-tools{margin-left:auto;display:flex;align-items:center;padding-right:8px}
.result-workspace :deep(.panel.results-panel),.result-workspace :deep(.panel.compact-fit-results){border:0;border-radius:0;box-shadow:none}
.result-workspace :deep(.analysis-archive){border:0;border-top:1px solid var(--ui-border);border-radius:0}
.result-workspace[data-result-view=results] :deep([data-result-section=diagnostics]),
.result-workspace[data-result-view=results] :deep([data-result-section=archive]),
.result-workspace[data-result-view=diagnostics] :deep([data-result-section=results]),
.result-workspace[data-result-view=diagnostics] :deep([data-result-section=archive]),
.result-workspace[data-result-view=archive] :deep([data-result-section=results]),
.result-workspace[data-result-view=archive] :deep([data-result-section=diagnostics]){display:none!important}
@media(pointer:coarse){.result-view-tabs button{min-height:44px;height:auto}}

.result-workspace:not(.single-result-workspace) :deep([data-result-section=overview]){display:none}
.single-result-workspace:not([data-result-view=parameters]) :deep([data-result-section=results]),
.single-result-workspace:not([data-result-view=results]) :deep([data-result-section=overview]),
.single-result-workspace[data-result-view=parameters] :deep([data-result-section=diagnostics]),
.single-result-workspace[data-result-view=parameters] :deep([data-result-section=archive]){display:none!important}
.result-workspace[data-result-view=archive] :deep([data-result-section=review]),
.result-workspace[data-result-view=parameters] :deep([data-result-section=review]),
.single-result-workspace[data-result-view=results] :deep([data-result-section=review]),
.single-result-workspace[data-result-view=results] :deep(.compact-result-warnings){display:none}
.single-result-workspace:is([data-result-view=results],[data-result-view=parameters])
  :deep(:is(.results-heading,.compact-result-heading,.result-context,.result-quality-note)),
.single-result-workspace[data-result-view=parameters]
  :deep(:is(.compact-result-warnings,.compact-result-summary,.result-quality,.with-table-status)){display:none}

/* 归档保留当前复核状态及过期提示，详细诊断由诊断页承载。 */
.single-result-workspace[data-result-view=archive]
  :deep(:is(.results-heading,.compact-result-heading,.result-context,.result-quality-note,.result-quality,.compact-result-summary,.compact-result-warnings)){display:none}
.single-result-workspace[data-result-view=archive] :deep(:is(.results-panel,.compact-fit-results)){padding-bottom:0}
.single-result-workspace[data-result-view=archive] :deep(.result-diagnostic-state){margin:0 0 var(--ui-space-2)}
.single-result-workspace :deep(.analysis-archive){min-width:0;border:0;padding:0 var(--ui-space-2) var(--ui-space-2)}

/* 两个页签的折叠入口共用相同文字和箭头边界，鼠标和键盘均可展开。 */
.single-result-workspace:is([data-result-view=diagnostics],[data-result-view=archive])
  :deep(:is(.result-details,.compact-result-warnings,.fit-file-exports,.scenario-comparison,.analysis-report-actions) > summary) {
  display: flex; align-items: center; gap: var(--ui-space-2); width: 100%;
  min-height: var(--ui-control-height-compact); padding: 4px 0; list-style: none;
  font-size: 13px; font-weight: 600;
}
.single-result-workspace:is([data-result-view=diagnostics],[data-result-view=archive])
  :deep(:is(.result-details,.compact-result-warnings,.fit-file-exports,.scenario-comparison,.analysis-report-actions) > summary::-webkit-details-marker) { display: none; }
.single-result-workspace:is([data-result-view=diagnostics],[data-result-view=archive])
  :deep(:is(.result-details,.compact-result-warnings,.fit-file-exports,.scenario-comparison,.analysis-report-actions) > summary::after) {
  content: ''; flex: none; width: 7px; height: 7px; margin: 0 4px 3px auto;
  border: solid currentColor; border-width: 0 1.5px 1.5px 0; transform: rotate(45deg);
}
.single-result-workspace:is([data-result-view=diagnostics],[data-result-view=archive])
  :deep(:is(.result-details,.compact-result-warnings,.fit-file-exports,.scenario-comparison,.analysis-report-actions)[open] > summary::after) { transform: rotate(225deg); margin-block: 3px 0; }
</style>
