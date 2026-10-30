<script setup lang="ts">
defineProps<{active:'chart'|'settings'|'results'}>();
defineEmits<{navigate:[view:'chart'|'settings'|'results']}>();
</script>
<template><nav class="workbench-view-nav" aria-label="工作区视图">
 <button v-for="item in [{id:'chart',label:'图谱',target:'analysis-plot'},{id:'settings',label:'设置',target:'analysis-settings'},{id:'results',label:'结果',target:'analysis-results'}] as const" :key="item.id" type="button" :aria-pressed="active===item.id" :aria-controls="item.target" :data-test="'view-'+item.id" @click="$emit('navigate',item.id)">{{item.label}}</button>
</nav></template>
