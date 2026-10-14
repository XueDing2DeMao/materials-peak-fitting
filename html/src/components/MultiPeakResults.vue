<script setup lang="ts">
import CompactFitResults from './CompactFitResults.vue';
import type { MultiResult } from '../multipeakTypes';
defineProps<{result:MultiResult|null;hideActions?:boolean;accepted?:boolean;selectedPeak?:string;stale:boolean;busy:boolean;unit:string}>();
const emit=defineEmits<{export:[kind:'curves'|'parameters'|'configuration'];image:[];select:[id:string]}>();
</script>
<template><CompactFitResults :result="result" :accepted="accepted" :selected-peak="selectedPeak" @select="emit('select',$event)" :hide-actions="hideActions" :stale="stale" :busy="busy" :unit="unit" prefix="multi" @export="emit('export',$event)" @image="emit('image')" /></template>
