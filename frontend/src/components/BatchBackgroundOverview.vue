<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { overviewBounds, overviewPoints, type OverviewData } from '../backgroundOverview';
const props=defineProps<{rows:{id:string;index:number;label:string;error:string;confirmed:boolean;preview:OverviewData|null}[];selected:number;unit:string;reversed:boolean;compact?:boolean}>();
const emit=defineEmits<{select:[index:number]}>();
const page=ref(0),pages=computed(()=>Math.max(1,Math.ceil(props.rows.length/6)));
const visible=computed(()=>props.rows.slice(page.value*6,page.value*6+6));
const bounds=computed(()=>overviewBounds(props.rows.flatMap(r=>r.preview?[r.preview]:[])));
const unified=ref(true);
const tiles=computed(()=>visible.value.map(row=>{
  const b=unified.value?bounds.value:overviewBounds(row.preview?[row.preview]:[]);
  return {...row,bounds:b,raw:row.preview?overviewPoints(row.preview.x,row.preview.raw_y,b,props.reversed):'',background:row.preview?overviewPoints(row.preview.x,row.preview.baseline,b,props.reversed):''};
}));
const fmt=(n:number)=>Number(n.toPrecision(4)).toString();
watch(()=>props.rows.map(r=>r.id).join(','),()=>{page.value=0;});
watch(()=>props.selected,index=>{page.value=Math.floor(Math.max(0,props.rows.findIndex(row=>row.index===index))/6);},{immediate:true});
</script>
<template>
  <section class="panel batch-overview" :class="{'is-compact':compact}" :aria-label="compact?'谱线缩略图':'整批背景概览'">
    <div v-if="!compact" class="batch-section-heading"><div><h3>背景概览</h3><p class="hint">实线：原谱；虚线：固定背景。点击返回对应单谱复核。</p></div><label class="overview-scale"><input type="checkbox" v-model="unified" />统一坐标范围</label><span>{{rows.length}} 条谱线</span></div>
    <div class="batch-overview-grid">
      <button v-for="r in tiles" :key="r.id" class="background-tile" :title="r.label" :aria-pressed="selected===r.index" :aria-label="`查看背景 ${r.index+1}：${r.label}`" @click="emit('select',r.index)">
        <strong>{{r.index+1}} · {{compact?r.label.split(' / ').at(-1):r.label}}</strong><span class="hint" :class="{'overview-confirmed':r.confirmed}">{{r.error?'预检失败':r.confirmed?'✓ 已复核':'待复核'}}</span>
        <svg v-if="r.preview&&r.bounds" viewBox="0 0 320 140" role="img" :aria-label="`第 ${r.index+1} 条原谱与背景缩略图`">
          <path d="M36 16V112H304" class="overview-axis" />
          <polyline :points="r.raw" class="overview-raw" />
          <polyline :points="r.background" class="overview-background" />
          <g v-if="!compact"><text x="32" y="22" text-anchor="end">{{fmt(r.bounds.ymax)}}</text><text x="32" y="112" text-anchor="end">{{fmt(r.bounds.ymin)}}</text>
          <text x="36" y="129">{{fmt(reversed?r.bounds.xmax:r.bounds.xmin)}}</text><text x="304" y="129" text-anchor="end">{{fmt(reversed?r.bounds.xmin:r.bounds.xmax)}}</text><text x="170" y="137" text-anchor="middle">{{unit}}</text></g>
        </svg>
        <p v-else class="error">{{r.error||'尚无背景预览'}}</p>
      </button>
    </div>
    <div class="batch-inline-actions"><button :disabled="page===0" @click="page--" aria-label="上一页背景">{{compact?'‹':'上一页背景'}}</button><span role="status">{{compact?`${page+1} / ${pages}`:`第 ${page+1} / ${pages} 页`}}</span><button :disabled="page+1>=pages" @click="page++" aria-label="下一页背景">{{compact?'›':'下一页背景'}}</button></div>
  </section>
</template>
<style scoped>
.overview-scale{display:flex;align-items:center;gap:8px;margin:0;font-size:12px}.overview-confirmed{color:#25643c}
.is-compact{display:flex;gap:10px;height:104px;padding:6px 10px;overflow:hidden}.is-compact .batch-overview-grid{flex:1;min-width:0;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px}.is-compact .background-tile{position:relative;padding:5px 8px;gap:0;overflow:hidden}.is-compact .background-tile[aria-pressed=true]{padding:4px 7px}.is-compact strong{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px;flex:none}.is-compact svg{height:52px;min-height:0}.is-compact .hint{position:absolute;right:6px;bottom:3px;font-size:11px;background:var(--ui-surface)}.is-compact .batch-inline-actions{display:grid;grid-template-columns:30px 30px;gap:4px;margin:0;align-content:center}.is-compact .batch-inline-actions span{grid-column:1/-1;grid-row:2;text-align:center;font-size:12px}.is-compact .batch-inline-actions button{min-height:30px;padding:0;font-size:18px}
</style>
