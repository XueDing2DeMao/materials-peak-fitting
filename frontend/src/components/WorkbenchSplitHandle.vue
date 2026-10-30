<script setup lang="ts">
import {ref} from 'vue';
const props=defineProps<{label:string;controls:string;side:'settings'|'results';value:number;min:number;max:number}>();
const emit=defineEmits<{resize:[value:number]}>();
const dragging=ref(false);
let start:{x:number;value:number;pointerId:number}|null=null;
const bounded=(value:number)=>Math.round(Math.max(props.min,Math.min(props.max,value)));
function begin(event:PointerEvent){
 if(event.button!==0||props.max<=props.min)return;
 event.preventDefault();const handle=event.currentTarget as HTMLElement;handle.focus();
 start={x:event.clientX,value:props.value,pointerId:event.pointerId};dragging.value=true;
 handle.setPointerCapture?.(event.pointerId);
}
function move(event:PointerEvent){if(!start||event.pointerId!==start.pointerId)return;emit('resize',bounded(start.value+(event.clientX-start.x)*(props.side==='settings'?1:-1)));}
function end(event:PointerEvent){if(!start||event.pointerId!==start.pointerId)return;move(event);start=null;dragging.value=false;}
function cancel(){if(start)emit('resize',start.value);start=null;dragging.value=false;}
function key(event:KeyboardEvent){
 const direction=props.side==='settings'?1:-1;
 const value=event.key==='Home'?props.min:event.key==='End'?props.max:event.key==='ArrowLeft'?props.value-24*direction:event.key==='ArrowRight'?props.value+24*direction:null;
 if(value===null)return;event.preventDefault();emit('resize',bounded(value));
}
</script>
<template><div class="workbench-split-handle" :class="[side+'-split',{'is-dragging':dragging}]" role="separator" tabindex="0" aria-orientation="vertical"
 :aria-label="label" :aria-controls="controls" :aria-valuemin="min" :aria-valuemax="max" :aria-valuenow="value" :aria-valuetext="value+' 像素'"
 :title="label+'：拖动或使用左右方向键；也可在“布局”中调整'" @pointerdown="begin" @pointermove="move" @pointerup="end" @pointercancel="cancel" @lostpointercapture="cancel" @keydown="key"><span aria-hidden="true" /></div></template>
<style scoped>
.workbench-split-handle{width:8px;min-height:0;cursor:col-resize;touch-action:none;display:flex;align-items:center;justify-content:center;border-radius:4px;outline-offset:-2px;user-select:none}
.workbench-split-handle span{height:44px;width:3px;background:var(--ui-border-strong);border-radius:3px}
.workbench-split-handle:hover,.workbench-split-handle:focus-visible,.is-dragging{background:var(--ui-selected)}
.workbench-split-handle:hover span,.workbench-split-handle:focus-visible span,.is-dragging span{background:var(--ui-primary)}
.settings-split{grid-area:settings-split}.results-split{grid-area:results-split}
</style>
