<script setup lang="ts">
import {computed,nextTick,onBeforeUnmount,ref} from 'vue';
import {loadDatasetRows} from '../api';
import type {DatasetInfo} from '../types';
import DatasetTable from './DatasetTable.vue';
const dialog=ref<HTMLDialogElement|null>(null),dataset=ref<DatasetInfo|null>(null),sheetName=ref('');
let trigger:HTMLElement|null=null;
const sheet=computed(()=>dataset.value?.sheets.find(s=>s.name===sheetName.value)??null);
async function open(value:DatasetInfo,event:Event){trigger=event.currentTarget as HTMLElement;dataset.value=value;sheetName.value=value.sheets[0]?.name??'';await nextTick();dialog.value?.showModal();}
function close(){if(dialog.value?.open)dialog.value.close();dataset.value=null;if(trigger?.isConnected)trigger.focus({preventScroll:true});trigger=null;}
onBeforeUnmount(()=>{trigger=null;close();});
defineExpose({open});
</script>
<template>
  <dialog ref="dialog" class="parameter-dialog dataset-import-dialog" aria-label="全部数据查看" @cancel.prevent="close" @close="close">
    <header class="parameter-dialog-header"><div><h2>查看全部数据</h2><p class="hint">{{dataset?.filename}} · 只读浏览，不改变批次列选择</p></div><button autofocus @click="close">关闭数据查看</button></header>
    <div v-if="dataset" class="parameter-dialog-body"><label class="browser-sheet-select">工作表<select v-model="sheetName"><option v-for="item in dataset.sheets" :key="item.name" :value="item.name">{{item.name}}（{{item.row_count}} 行）</option></select></label><DatasetTable :dataset-id="dataset.dataset_id" :sheet="sheet" :load="loadDatasetRows" /></div>
    <footer class="parameter-dialog-footer"><p class="hint">核对各列含义后，返回选择需要纳入批次的谱列。</p><button @click="close">返回谱列选择</button></footer>
  </dialog>
</template>
