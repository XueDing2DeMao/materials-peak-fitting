<script setup lang="ts">
import { nextTick, ref, useId } from 'vue';
export type ParameterSection = 'range' | 'baseline' | 'peaks';
defineProps<{modelValue:ParameterSection}>();
const emit=defineEmits<{'update:modelValue':[value:ParameterSection]}>();
const id=useId(),buttons=ref<HTMLButtonElement[]>([]);
const sections=[{id:'range',label:'分析区间'},{id:'baseline',label:'基线设置'},{id:'peaks',label:'峰参数'}] as const;
async function navigate(event:KeyboardEvent,index:number){
  const target=event.key==='Home'?0:event.key==='End'?2:event.key==='ArrowRight'?(index+1)%3:event.key==='ArrowLeft'?(index+2)%3:null;
  if(target===null)return;
  event.preventDefault();emit('update:modelValue',sections[target].id);await nextTick();buttons.value[target]?.focus();
}
</script>
<template><div class="parameter-tabs" role="tablist" aria-label="参数编辑模块">
  <button v-for="(section,index) in sections" :key="section.id" ref="buttons" type="button" role="tab" :id="`${id}-${section.id}`" :aria-selected="modelValue===section.id" :tabindex="modelValue===section.id?0:-1" :data-test="`parameter-tab-${section.id}`" @click="emit('update:modelValue',section.id)" @keydown="navigate($event,index)">{{section.label}}</button>
</div></template>
