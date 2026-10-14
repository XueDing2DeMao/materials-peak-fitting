<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import type {SheetInfo} from '../types';
import type {DatasetRows,DatasetRowsLoader} from '../datasetRows';
const props=defineProps<{datasetId:string;sheet:SheetInfo|null;load:DatasetRowsLoader;xColumn?:string;yColumn?:string;snapshot?:{x:number[];y:number[]}}>();
const page=ref<DatasetRows|null>(null),offset=ref(0),jump=ref(1),loading=ref(false),error=ref('');
const limit=100;
let generation=0;
const isSnapshot=computed(()=>props.datasetId.startsWith('session:'));
const total=computed(()=>isSnapshot.value?props.snapshot?.x.length??0:props.sheet?.row_count??0);
const pages=computed(()=>Math.max(1,Math.ceil(total.value/limit)));
const current=computed(()=>Math.floor(offset.value/limit)+1);
async function read(){
  const version=++generation;page.value=null;error.value='';loading.value=true;
  try{
    if(!props.sheet)return;
    const data=isSnapshot.value?{
      sheet:props.sheet.name,columns:props.sheet.columns.slice(0,2),offset:offset.value,limit,total_rows:total.value,
      row_numbers:(props.snapshot?.x.slice(offset.value,offset.value+limit)??[]).map((_,i)=>offset.value+i+1),
      rows:(props.snapshot?.x.slice(offset.value,offset.value+limit)??[]).map((x,i)=>[x,props.snapshot!.y[offset.value+i]??null]),
    }:await props.load(props.datasetId,props.sheet.name,offset.value,limit);
    if(version===generation)page.value=data;
  }catch(e){if(version===generation)error.value=e instanceof Error?e.message:String(e);}
  finally{if(version===generation)loading.value=false;}
}
function go(value:number){if(loading.value||!Number.isInteger(value)||value<1||value>pages.value)return;offset.value=(value-1)*limit;jump.value=value;void read();}
watch(()=>[props.datasetId,props.sheet,props.snapshot],()=>{offset.value=0;jump.value=1;void read();},{immediate:true});
onBeforeUnmount(()=>generation++);
</script>
<template>
  <section class="dataset-table" aria-label="全部数据浏览" :aria-busy="loading">
    <p class="hint">{{isSnapshot?'会话已保存的 X/Y 原谱快照；其他工作表或列需重新导入原文件。':'解析表数据：已移除全空行／列，保留其他全部列与非数值单元格；未按 X/Y 有效性筛选或排序。'}}</p>
    <div class="data-table-toolbar">
      <span role="status">{{loading?'正在读取…':`共 ${total.toLocaleString()} 行 · 第 ${current} / ${pages} 页`}}</span>
      <div class="data-pagination"><button data-test="data-prev" :disabled="loading||current<=1" @click="go(current-1)">上一页</button><button data-test="data-next" :disabled="loading||current>=pages" @click="go(current+1)">下一页</button><label>页码<input v-model.number="jump" aria-label="数据页码" type="number" min="1" :max="pages" :disabled="loading" @keydown.enter.prevent="go(Number(jump))" /></label><button data-test="data-jump" :disabled="loading||!Number.isInteger(jump)||jump<1||jump>pages" @click="go(Number(jump))">跳转</button></div>
    </div>
    <div v-if="error" role="alert" class="error">{{error}} <button data-test="data-retry" @click="read">重试读取</button></div>
    <div v-else class="full-data-scroll" tabindex="0" role="region" aria-label="全部列与分页数据表">
      <table v-if="page"><thead><tr><th scope="col">{{isSnapshot?'快照行号':'解析行号'}}</th><th v-for="(column,i) in page.columns" :key="i" scope="col" :class="{'selected-data-column':column===xColumn||column===yColumn}">{{column}}<small v-if="column===xColumn">X 列</small><small v-if="column===yColumn">Y 列</small></th></tr></thead><tbody><tr v-for="(row,i) in page.rows" :key="i"><th scope="row">{{page.row_numbers[i]}}</th><td v-for="(value,j) in row" :key="j" :class="{'selected-data-column':page.columns[j]===xColumn||page.columns[j]===yColumn}">{{value===null?'—':value}}</td></tr></tbody></table>
      <p v-if="page&&!page.rows.length" class="hint">当前页没有数据。</p>
    </div>
    <p class="hint">每页 100 行，翻页可查看全部数据。{{isSnapshot?'':'解析行号不含表头，不等于文本文件的物理行号；— 表示缺失，Infinity / -Infinity 表示非有限值。'}}</p>
  </section>
</template>
