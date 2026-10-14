<script setup lang="ts">
import { ref } from 'vue';
import type { MetadataByTask } from '../batchTrend';
const props=defineProps<{rows:{id:string;label:string}[];metadata:MetadataByTask;disabled:boolean}>();
const emit=defineEmits<{change:[]}>();
const name=ref(''),unit=ref('');
function apply(){if(props.disabled)return;for(const r of props.rows){props.metadata[r.id].condition_name=name.value.trim();props.metadata[r.id].condition_unit=unit.value.trim();}emit('change');}
function value(id:string,event:Event){const text=(event.target as HTMLInputElement).value;props.metadata[id].condition_value=text===''?null:Number(text);emit('change');}
</script>
<template>
  <details class="batch-metadata"><summary>实验记录（可选） · 样品、条件与重复编号</summary>
    <p class="hint">每条谱线独立记录。温度／时间填写在条件列，重复编号单列记录，不自动当作连续变量。</p>
    <fieldset :disabled="disabled"><legend class="sr-only">实验条件编辑</legend>
      <div class="batch-trend-controls"><label>统一条件名称<input v-model="name" maxlength="200" placeholder="例如：退火温度" /></label><label>统一条件单位<input v-model="unit" maxlength="200" placeholder="例如：°C" /></label><button :disabled="!name.trim()||!unit.trim()" @click="apply">应用名称与单位到纳入谱线</button></div>
      <div class="batch-table-scroll" tabindex="0" role="region" aria-label="实验记录表"><table><thead><tr><th>谱线</th><th>样品编号</th><th>条件名称</th><th>条件值</th><th>单位</th><th>重复编号</th></tr></thead><tbody><tr v-for="(r,i) in rows" :key="r.id"><th>{{i+1}} · {{r.label}}</th><td><input maxlength="200" v-model="metadata[r.id].sample_id" :aria-label="`谱线 ${i+1} 样品编号`" @input="emit('change')" /></td><td><input maxlength="200" v-model="metadata[r.id].condition_name" :aria-label="`谱线 ${i+1} 条件名称`" @input="emit('change')" /></td><td><input :value="metadata[r.id].condition_value??''" type="number" step="any" :aria-label="`谱线 ${i+1} 条件值`" @input="value(r.id,$event)" /></td><td><input maxlength="200" v-model="metadata[r.id].condition_unit" :aria-label="`谱线 ${i+1} 条件单位`" @input="emit('change')" /></td><td><input maxlength="200" v-model="metadata[r.id].replicate_id" :aria-label="`谱线 ${i+1} 重复编号`" @input="emit('change')" /></td></tr></tbody></table></div>
    </fieldset>
  </details>
</template>
