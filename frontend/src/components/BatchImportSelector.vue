<script setup lang="ts">
import { computed, ref } from 'vue';
import DatasetBrowserDialog from './DatasetBrowserDialog.vue';
import { duplicateSelections, selectedSpectra, type SheetSelection, type SpectrumSelection } from '../batchSelection';
import DataSelectionPreview from './DataSelectionPreview.vue';
const props=defineProps<{drafts:SheetSelection[];existing:SpectrumSelection[];disabled:boolean}>();
const emit=defineEmits<{commit:[rows:SpectrumSelection[]];cancel:[]}>();
const browser=ref<InstanceType<typeof DatasetBrowserDialog>|null>(null);
const files=computed(()=>[...new Set(props.drafts.map(d=>d.dataset))]);
const count=computed(()=>props.drafts.reduce((n,d)=>n+d.yColumns.length,0));
const validation=computed(()=>{try{return {rows:selectedSpectra(props.drafts,props.existing.length),error:''};}catch(e){return {rows:[],error:(e as Error).message};}});
const duplicates=computed(()=>duplicateSelections(validation.value.rows,props.existing));
function sheet(d:SheetSelection){return d.dataset.sheets.find(s=>s.name===d.sheet)!;}
function select(group:SheetSelection[],all:boolean){for(const d of group)d.yColumns=all?sheet(d).numeric_columns.filter(c=>c!==d.xColumn):[];}
</script>
<template>
  <section class="batch-selection" aria-label="待纳入谱线选择" data-test="batch-selection">
    <div class="batch-section-heading"><div><h3>选择本次分析的原谱列</h3><p class="hint">先核对数据角色；不勾选的误差、温度或统计列不会生成任务。</p></div><strong role="status">将新增 {{count}} 条</strong></div>
    <fieldset :disabled="disabled"><legend class="sr-only">暂存文件与工作表</legend>
      <div class="batch-inline-actions"><button type="button" data-test="batch-select-all" @click="select(drafts,true)">选择全部候选 Y</button><button type="button" @click="select(drafts,false)">取消全部选择</button></div>
      <details v-for="file in files" :key="file.dataset_id" open class="batch-selection-file">
        <summary>{{file.filename}} · {{drafts.filter(d=>d.dataset===file).length}} 个可选工作表</summary>
        <div class="batch-inline-actions"><button @click="browser?.open(file,$event)">查看全部数据</button><button @click="select(drafts.filter(d=>d.dataset===file),true)">选择此文件全部 Y</button><button @click="select(drafts.filter(d=>d.dataset===file),false)">取消此文件</button></div>
        <details v-for="d in drafts.filter(d=>d.dataset===file)" :key="d.key" class="batch-selection-sheet" open>
          <summary>{{d.sheet}} · 已选 {{d.yColumns.length}} / {{sheet(d).numeric_columns.length-1}}</summary>
          <label>X 列 · {{d.sheet}}<select v-model="d.xColumn" :aria-label="`${file.filename} / ${d.sheet} X 列`" @change="d.yColumns=d.yColumns.filter(y=>y!==d.xColumn)"><option v-for="c in sheet(d).numeric_columns" :key="c">{{c}}</option></select></label>
          <div class="batch-inline-actions"><button @click="select([d],true)">选择此表全部 Y</button><button @click="select([d],false)">取消此表</button></div>
          <div class="batch-y-choices"><label v-for="c in sheet(d).numeric_columns.filter(c=>c!==d.xColumn)" :key="c"><input v-model="d.yColumns" type="checkbox" :value="c" :aria-label="`${file.filename} / ${d.sheet} 纳入 ${c}`" />{{c}}</label></div>
          <details><summary>核对前 5 行原始值</summary><DataSelectionPreview :sheet="sheet(d)" :x-column="d.xColumn" :y-column="d.yColumns[0]??''" /></details>
        </details>
      </details>
      <p v-if="duplicates.length" role="status" class="warning">{{duplicates.length}} 条选择与当前批次或本次选择重复。仍可纳入；请确认是否为有意重复，重复导入不代表独立重复实验。</p>
      <p v-if="validation.error" role="alert" class="error">{{validation.error}}</p>
      <div class="batch-inline-actions"><button class="primary" data-test="batch-commit-selection" :disabled="!count||Boolean(validation.error)" @click="emit('commit',validation.rows)">纳入所选谱线（{{count}}）</button><button @click="emit('cancel')">取消本次导入</button></div>
    </fieldset>
    <DatasetBrowserDialog ref="browser" />
  </section>
</template>
