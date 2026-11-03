<script setup lang="ts">
import CompactFitResults from './CompactFitResults.vue';
import type { XpsResult } from '../xpsTypes';
defineProps<{yUnit?:string;locatable?:boolean;result:XpsResult|null;hideActions?:boolean;accepted?:boolean;selectedPeak?:string;stale:boolean;busy:boolean}>();
const emit=defineEmits<{navigate:[target:'baseline'|'peaks'|'chart'|'diagnostics'];locate:[id:string,parameter:string];export:[kind:'curves'|'parameters'|'configuration'];image:[];select:[id:string]}>();
</script>
<template><CompactFitResults :y-unit="yUnit" @navigate="emit('navigate',$event)" :locatable="locatable" @locate="(id,parameter)=>emit('locate',id,parameter)" :result="result" :accepted="accepted" :selected-peak="selectedPeak" @select="emit('select',$event)" :hide-actions="hideActions" :stale="stale" :busy="busy" unit="eV" prefix="xps" @export="emit('export',$event)" @image="emit('image')" /></template>
