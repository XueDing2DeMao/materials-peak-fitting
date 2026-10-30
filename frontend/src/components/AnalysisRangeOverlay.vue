<script setup lang="ts">
import { computed } from 'vue';
import { formatAxisValue, type AnalysisRange } from '../useAnalysisRange';
const props=defineProps<{geometry:{left:number;top:number;width:number;height:number}|null;range:AnalysisRange|null|undefined;rangeEditing:boolean;selectionMode:boolean;reversed?:boolean;startVisible:boolean;endVisible:boolean}>();
defineEmits<{drag:[kind:'start'|'end'|'move',event:PointerEvent]}>();
const overlayStyle=computed(()=>props.geometry?Object.fromEntries(Object.entries(props.geometry).map(([k,v])=>[k,`${v}px`])):{});
</script>
<template>      <div v-if="geometry && range && rangeEditing && !selectionMode" data-test="range-manipulator" class="range-manipulator" :class="{'range-reversed':reversed}" :style="overlayStyle" aria-label="分析范围直接调整">
        <div class="range-manipulator-tint" :style="{borderLeftColor:(reversed?endVisible:startVisible)?undefined:'transparent',borderRightColor:(reversed?startVisible:endVisible)?undefined:'transparent'}" aria-hidden="true"/>
        <button v-if="startVisible" data-test="range-start-handle" class="range-boundary-handle start" type="button" :aria-label="`拖动分析范围起点：${formatAxisValue(range.start)}`" title="拖动调整起点" @pointerdown.stop.prevent="$emit('drag', 'start', $event)">
          <span aria-hidden="true">↔</span>
        </button>
        <button data-test="range-window-handle" class="range-window-handle" type="button" aria-label="拖动分析范围整体平移" title="拖动整体平移分析范围" @pointerdown.stop.prevent="$emit('drag', 'move', $event)">
          <span aria-hidden="true">↔</span>
        </button>
        <button v-if="endVisible" data-test="range-end-handle" class="range-boundary-handle end" type="button" :aria-label="`拖动分析范围终点：${formatAxisValue(range.end)}`" title="拖动调整终点" @pointerdown.stop.prevent="$emit('drag', 'end', $event)">
          <span aria-hidden="true">↔</span>
        </button>
      </div>
</template>
<style scoped>
.range-reversed .range-boundary-handle.start {left:auto;right:-8px;}
.range-reversed .range-boundary-handle.end {right:auto;left:-8px;}
.range-reversed .range-manipulator-tint {border-left-color:#236a9a;border-right-color:#087b79;}
</style>
