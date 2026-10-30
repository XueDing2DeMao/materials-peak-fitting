<script setup lang="ts">
defineProps<{expanded:boolean;settingsWidth:number;resultWidth:number;settingsMax:number;resultMax:number;resultsOpen:boolean;stacked:boolean}>();
defineEmits<{toggle:[];resize:[panel:'settings'|'results',value:number];reset:[]}>();
</script>
<template><div class="workbench-layout-tools">
 <button type="button" data-test="expand-chart" :aria-pressed="expanded" aria-controls="analysis-plot" @click="$emit('toggle')">{{expanded?'恢复工作布局':'放大图谱'}}</button>
 <details v-show="!expanded" class="workbench-layout-options"><summary>布局</summary><div class="layout-options-body">
  <p>拖动栏间边界，或点击按钮调整宽度。</p>
  <div class="layout-width-row"><span>设置栏 {{settingsWidth}} px</span><button type="button" aria-label="缩窄设置栏" :disabled="settingsWidth<=232" @click="$emit('resize','settings',settingsWidth-24)">−</button><button type="button" aria-label="加宽设置栏" :disabled="settingsWidth>=settingsMax" @click="$emit('resize','settings',settingsWidth+24)">+</button></div>
  <div v-if="resultsOpen&&!stacked" class="layout-width-row"><span>结果栏 {{resultWidth}} px</span><button type="button" aria-label="缩窄结果栏" :disabled="resultWidth<=288" @click="$emit('resize','results',resultWidth-24)">−</button><button type="button" aria-label="加宽结果栏" :disabled="resultWidth>=resultMax" @click="$emit('resize','results',resultWidth+24)">+</button></div>
  <button type="button" data-test="reset-layout" @click="$emit('reset')">恢复默认栏宽</button>
 </div></details>
</div></template>
<style scoped>
.workbench-layout-tools{display:flex;align-items:center;gap:8px;flex:none}.workbench-layout-options{position:relative}.workbench-layout-options>summary{cursor:pointer;padding:6px 10px;border:1px solid var(--ui-border);border-radius:5px;font-size:12px;background:var(--ui-surface)}
.layout-options-body{position:absolute;z-index:50;top:calc(100% + 5px);left:0;width:260px;padding:12px;background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:6px;box-shadow:var(--ui-shadow)}
.layout-options-body p{font-size:13px;line-height:1.5;margin:0 0 10px}.layout-width-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:13px}.layout-width-row span{flex:1}.layout-width-row button{min-width:32px;height:32px;font-size:16px}.layout-options-body>button{width:100%}
</style>
