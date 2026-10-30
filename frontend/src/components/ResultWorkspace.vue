<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';

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
    <div class="result-view-tabs" role="tablist" aria-label="结果视图">
      <button v-for="(item,index) in views" :key="item.id" ref="tabs" type="button"
        :id="`${id}-${item.id}`" role="tab" :aria-selected="view===item.id"
        :aria-controls="`${id}-content`" :tabindex="view===item.id?0:-1"
        :data-test="`result-view-${item.id}`" @click="view=item.id" @keydown="navigate($event,index)">{{item.label}}</button>
    </div>
    <div :id="`${id}-content`" role="tabpanel" :aria-labelledby="`${id}-${view}`">
      <!-- 内容保持挂载，切换视图不丢失参数弹窗、比较设置及归档备注。 -->
      <slot />
      <div v-show="view==='archive'" class="result-archive-content"><slot name="archive" /></div>
    </div>
  </section>
</template>

<style scoped>
.result-workspace{min-width:0;border:1px solid var(--ui-border);border-radius:var(--ui-panel-radius);background:var(--ui-surface);overflow:clip}
.result-view-tabs{display:flex;flex-wrap:wrap;gap:4px;padding:10px 14px;border-bottom:1px solid var(--ui-border);background:var(--ui-subtle)}
.result-view-tabs button{border-color:transparent;background:transparent;color:var(--ui-text-muted);height:36px}
.result-view-tabs button[aria-selected=true]{background:var(--ui-surface);border-color:var(--ui-border);color:var(--ui-primary);font-weight:600}
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
.result-workspace[data-result-view=parameters] :deep([data-result-section=review]){display:none}
</style>
