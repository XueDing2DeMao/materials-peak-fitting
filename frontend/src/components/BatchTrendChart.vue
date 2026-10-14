<script setup lang="ts">
import { computed,nextTick,onBeforeUnmount,onMounted,ref,watch } from 'vue';
import Plotly from 'plotly.js-dist-min';
import { figureAxis,figureLayout,FIGURE_COLORS } from '../figureStyle';
import { PLOTLY_CHINESE_CONFIG } from '../plotlyLocale';
import { conditionAxis,constantTrendRange,emptyMetadata,trendPoints,type MetadataByTask,type TrendMetric } from '../batchTrend';
import type { BatchRow } from '../batchTypes';
const props=defineProps<{rows:BatchRow[];metadata:MetadataByTask;unit:string}>();
const emit=defineEmits<{select:[rowId:string,peakId:string]}>();
const peak=ref(''),metric=ref<TrendMetric>('position'),axis=ref<'sequence'|'condition'>('sequence'),plot=ref<HTMLElement|null>(null),error=ref('');
const peaks=computed(()=>{const map=new Map<string,string>();for(const r of props.rows)for(const p of r.request.components)if(p.enabled!==false)map.set(p.id,p.label);return [...map].map(([id,label])=>({id,label}));});
watch(peaks,p=>{if(!p.some(p=>p.id===peak.value))peak.value=p[0]?.id??'';},{immediate:true});
const condition=computed(()=>conditionAxis(props.rows.map(r=>props.metadata[r.id]??emptyMetadata())));
watch(condition,c=>{if(!c.available)axis.value='sequence';});
const points=computed(()=>trendPoints(props.rows,peak.value,metric.value,props.metadata,axis.value));
const metricNames={position:'峰顶位置',fwhm:'整体 FWHM',area_window:'区间面积',area_total:'全域面积'};
const valueUnit=computed(()=>metric.value.startsWith('area')?`Y × ${props.unit}`:props.unit);
const fmt=(v:number|null)=>v===null?'—':Number(v.toPrecision(6)).toString();
let observer:ResizeObserver|undefined,disposed=false,drawing=false,again=false;
async function draw(){
  if(!plot.value||disposed)return;if(drawing){again=true;return;}drawing=true;const node=plot.value;
  try{
    const groups=[...new Set(points.value.map(p=>p.status))];
    const traces=groups.map(status=>{const rows=points.value.filter(p=>p.status===status&&p.value!==null&&p.x!==null);return {type:'scatter',mode:'markers',name:status,x:rows.map(p=>p.x),y:rows.map(p=>p.value),customdata:rows.map(p=>p.rowId),text:rows.map(p=>`谱线 ${p.index} · ${peak.value}`),marker:{symbol:rows[0]?.symbol??'circle',size:9,color:FIGURE_COLORS.fit},hovertemplate:'%{text}<br>X=%{x}<br>值=%{y}<extra>%{fullData.name}</extra>'};});
    await Plotly.react(node,traces,{...figureLayout(node.clientWidth),height:360,margin:{l:78,r:20,t:70,b:65},xaxis:{...figureAxis(axis.value==='sequence'?'执行序号':condition.value.label),dtick:axis.value==='sequence'?Math.max(1,Math.ceil(props.rows.length/15)):undefined},yaxis:{...figureAxis(`${metricNames[metric.value]} / ${valueUnit.value}`),range:constantTrendRange(points.value.map(p=>p.value))},dragmode:'pan'}, {...PLOTLY_CHINESE_CONFIG,scrollZoom:false,displaylogo:false});
    const el=node as HTMLElement&{on?:(name:string,handler:(event:any)=>void)=>void;removeAllListeners?:(name:string)=>void};
    el.removeAllListeners?.('plotly_click');el.on?.('plotly_click',event=>{const id=event.points?.[0]?.customdata;if(points.value.some(p=>p.rowId===id))emit('select',id,peak.value);});error.value='';
  }catch(e){error.value=`趋势图绘制失败：${e instanceof Error?e.message:String(e)}；仍可使用下方表格。`;}
  finally{drawing=false;if(disposed)Plotly.purge(node);else if(again){again=false;void draw();}}
}
watch([points,metric,axis],()=>nextTick(draw));
onMounted(()=>{void draw();if(typeof ResizeObserver!=='undefined'&&plot.value){let width=0;observer=new ResizeObserver(e=>{const w=e[0]?.contentRect.width;if(w&&w!==width){width=w;void draw();}});observer.observe(plot.value);}});
onBeforeUnmount(()=>{disposed=true;observer?.disconnect();if(plot.value&&!drawing)Plotly.purge(plot.value);});
</script>
<template>
  <section class="panel batch-trends" aria-label="批次峰参数趋势">
    <div class="batch-section-heading"><div><h3>峰参数趋势</h3><p class="hint">按稳定峰 ID 比较；点间不插值。点击图中点或表格“定位”返回对应原谱与峰。</p></div></div>
    <div class="batch-trend-controls"><label>比较峰<select v-model="peak" aria-label="趋势峰"><option v-for="p in peaks" :key="p.id" :value="p.id">{{p.id}} · {{p.label}}</option></select></label><label>指标<select v-model="metric" aria-label="趋势指标"><option v-for="(name,id) in metricNames" :key="id" :value="id">{{name}}</option></select></label><label>横轴<select v-model="axis" aria-label="趋势横轴"><option value="sequence">执行序号</option><option value="condition" :disabled="!condition.available">{{condition.label}}</option></select></label></div>
    <p v-if="!condition.available" class="hint">{{condition.reason}}</p><p class="hint">圆点：未触发诊断；三角：有警告／待复核；菱形：人工接受。失败、跳过和缺失值不绘制为零，完整状态见表格。</p>
    <div ref="plot" class="batch-trend-plot" role="img" :aria-label="`${peak} ${metricNames[metric]}趋势图；下方提供等价表格`" />
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <details open><summary>数值与状态 · {{points.length}} 条</summary><div class="batch-table-scroll batch-trend-table" tabindex="0" role="region" aria-label="趋势等价表格"><table><thead><tr><th>谱线 / 样品</th><th>{{axis==='sequence'?'执行序号':condition.label}}</th><th>{{metricNames[metric]}} / {{valueUnit}}</th><th>诊断与人工状态</th><th>操作</th></tr></thead><tbody><tr v-for="p in points" :key="p.rowId"><th>{{p.index}} · {{p.label}}<small v-if="p.sample">样品 {{p.sample}} · 重复编号 {{p.replicate||'未填'}}</small></th><td>{{fmt(p.x)}}</td><td>{{fmt(p.value)}}</td><td>{{p.status}}</td><td><button :aria-label="`定位谱线 ${p.index} 的 ${peak}`" @click="emit('select',p.rowId,peak)">定位</button></td></tr></tbody></table></div></details>
    <p class="hint">条件值相同仍保留独立点，不自动平均或生成置信区间。未做跨谱强度归一化，面积比较需核对采集与预处理条件。</p>
  </section>
</template>
