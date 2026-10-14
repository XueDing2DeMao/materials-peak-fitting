<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { overviewBounds, overviewPoints, type OverviewData } from '../backgroundOverview';
const props=defineProps<{rows:{id:string;index:number;label:string;error:string;confirmed:boolean;preview:OverviewData|null}[];selected:number;unit:string;reversed:boolean}>();
const emit=defineEmits<{select:[index:number]}>();
const page=ref(0),pages=computed(()=>Math.max(1,Math.ceil(props.rows.length/6)));
const visible=computed(()=>props.rows.slice(page.value*6,page.value*6+6));
const bounds=computed(()=>overviewBounds(props.rows.flatMap(r=>r.preview?[r.preview]:[])));
const fmt=(n:number)=>Number(n.toPrecision(4)).toString();
watch(()=>props.rows.map(r=>r.id).join(','),()=>{page.value=0;});
</script>
<template>
  <section class="panel batch-overview" aria-label="整批背景概览">
    <div class="batch-section-heading"><div><h3>背景概览</h3><p class="hint">各图使用整批相同坐标范围与原始强度。实线：原谱；虚线：固定背景。点击查看完整谱线。</p></div><span>{{rows.length}} 条谱线</span></div>
    <p class="hint">预检仅检查输入与数值条件；背景适用性仍需人工判断。翻页浏览后，可在谱线列表中一键复核，包含筛选隐藏项。</p>
    <div class="batch-overview-grid">
      <button v-for="r in visible" :key="r.id" class="background-tile" :aria-pressed="selected===r.index" :aria-label="`查看背景 ${r.index+1}：${r.label}`" @click="emit('select',r.index)">
        <strong>{{r.index+1}} · {{r.label}}</strong><span class="hint">{{r.error?'预检失败':r.confirmed?'背景已复核':'背景待复核'}}</span>
        <svg v-if="r.preview&&bounds" viewBox="0 0 320 140" role="img" :aria-label="`第 ${r.index+1} 条原谱与背景缩略图`">
          <path d="M36 16V112H304" class="overview-axis" />
          <polyline :points="overviewPoints(r.preview.x,r.preview.raw_y,bounds,reversed)" class="overview-raw" />
          <polyline :points="overviewPoints(r.preview.x,r.preview.baseline,bounds,reversed)" class="overview-background" />
          <text x="32" y="22" text-anchor="end">{{fmt(bounds.ymax)}}</text><text x="32" y="112" text-anchor="end">{{fmt(bounds.ymin)}}</text>
          <text x="36" y="129">{{fmt(reversed?bounds.xmax:bounds.xmin)}}</text><text x="304" y="129" text-anchor="end">{{fmt(reversed?bounds.xmin:bounds.xmax)}}</text><text x="170" y="137" text-anchor="middle">{{unit}}</text>
        </svg>
        <p v-else class="error">{{r.error||'尚无背景预览'}}</p>
      </button>
    </div>
    <div class="batch-inline-actions"><button :disabled="page===0" @click="page--">上一页背景</button><span role="status">第 {{page+1}} / {{pages}} 页</span><button :disabled="page+1>=pages" @click="page++">下一页背景</button></div>
  </section>
</template>
