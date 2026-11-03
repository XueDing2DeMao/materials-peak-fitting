<script setup lang="ts">
import WorkbenchMenu from './WorkbenchMenu.vue';
defineProps<{expanded:boolean;settingsWidth:number;resultHeight:number;settingsMax:number;resultMax:number;resultsOpen:boolean;stacked:boolean}>();
defineEmits<{toggle:[];resize:[panel:'settings'|'results',value:number];reset:[]}>();
</script>
<template><div class="workbench-layout-tools">
 <button type="button" class="workbench-command" data-test="expand-chart" :aria-pressed="expanded" aria-controls="analysis-plot" @click="$emit('toggle')">{{expanded?'恢复工作布局':'放大图谱'}}</button>
 <WorkbenchMenu v-if="!expanded" label="布局"><div class="layout-options-body">
  <p>拖动分隔线或用下方按钮调整设置栏宽度、结果区高度。</p>
  <div class="layout-width-row"><span>设置栏 {{settingsWidth}} px</span><button type="button" aria-label="缩窄设置栏" :disabled="settingsWidth<=232" @click="$emit('resize','settings',settingsWidth-24)">−</button><button type="button" aria-label="加宽设置栏" :disabled="settingsWidth>=settingsMax" @click="$emit('resize','settings',settingsWidth+24)">+</button></div>
  <div v-if="resultsOpen" class="layout-width-row"><span>结果区 {{resultHeight}} px</span><button type="button" aria-label="缩短结果区" :disabled="resultHeight<=160" @click="$emit('resize','results',resultHeight-24)">−</button><button type="button" aria-label="增高结果区" :disabled="resultHeight>=resultMax" @click="$emit('resize','results',resultHeight+24)">+</button></div>
  <button type="button" data-test="reset-layout" @click="$emit('reset')">恢复默认布局</button>
 </div></WorkbenchMenu>
</div></template>
<style scoped>
.workbench-layout-tools{display:flex;align-items:center;gap:var(--ui-toolbar-gap);flex:none}
.layout-options-body{width:236px;padding:4px}
.layout-options-body p{font-size:13px;line-height:1.5;margin:0 0 10px}.layout-width-row{display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:13px}.layout-width-row span{flex:1}.layout-width-row button{min-width:32px;height:32px;font-size:16px}.layout-options-body>button{width:100%}
</style>
