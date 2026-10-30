<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import Plotly from 'plotly.js-dist-min';
import { isMulti } from '../fitAdapter';
import { componentLine, figureAxis, figureLayout, FIGURE_COLORS } from '../figureStyle';
import { PLOTLY_CHINESE_CONFIG } from '../plotlyLocale';
import type { BatchRequest, BatchResult } from '../batchTypes';
import type { MultiPreview } from '../multipeakTypes';
import type { XpsPreview } from '../xpsTypes';

const props=defineProps<{request:BatchRequest;preview:MultiPreview|XpsPreview;result:BatchResult|null;selectedPeak:string;fill?:boolean}>();
const plot=ref<HTMLElement|null>(null),full=ref(false),expanded=ref(false),error=ref('');
const container=ref<HTMLElement|null>(null),resetVersion=ref(0);
const chartHeight=computed(()=>expanded.value?760:props.result?490:350);
const xps=computed(()=>!isMulti(props.request));
const xLabel=computed(()=>xps.value?'结合能 / eV':isMulti(props.request)&&props.request.analysis_mode==='xrd'?'2θ / °':'X（原数据单位）');
const shifted=computed(()=>props.request.x.map(x=>x+(isMulti(props.request)?0:props.request.shift_eV)));
let observer:ResizeObserver|undefined,disposed=false,drawing=false,redraw=false;

function intensityRange(traces:Record<string,unknown>[],start:number,end:number){
  let low=Infinity,high=-Infinity;
  for(const trace of traces){
    if(trace.yaxis==='y2')continue;
    const x=trace.x as number[],y=trace.y as number[];
    for(let i=0;i<x.length;i++)if(x[i]>=start&&x[i]<=end&&Number.isFinite(y[i])){
      low=Math.min(low,y[i]);high=Math.max(high,y[i]);
    }
  }
  if(!Number.isFinite(low)||!Number.isFinite(high))return undefined;
  const padding=(high-low||Math.abs(high)||1)*.08;
  return [low-padding,high+padding];
}
async function draw(){
  if(!plot.value||disposed)return;
  const width=container.value?.clientWidth??0,height=props.fill?container.value?.clientHeight??0:chartHeight.value;
  if(width<=0||height<=0)return;
  if(drawing){redraw=true;return;}
  const node=plot.value;
  drawing=true;
  try{
    const request=props.request,result=props.result;
    const range=full.value?shifted.value.reduce(([low,high],x)=>[Math.min(low,x),Math.max(high,x)],[Infinity,-Infinity]):[request.range_start,request.range_end];
    if(xps.value)range.reverse();
    const traces:Record<string,unknown>[]=[
      {x:shifted.value,y:request.y,name:'原始谱',type:'scatter',mode:'markers',marker:{size:3.5,color:FIGURE_COLORS.observation,opacity:.7}},
      {x:props.preview.x,y:props.preview.baseline,name:'固定背景',type:'scatter',mode:'lines',line:{color:FIGURE_COLORS.background,dash:'dash',width:1.5}},
    ];
    if(result){
      traces.push({x:result.x,y:result.total_y,name:'总拟合',type:'scatter',mode:'lines',line:{color:FIGURE_COLORS.fit,width:2.2}});
      for(const component of result.components){
        const highlighted=props.selectedPeak===component.id;
        traces.push({x:result.x,y:component.y,name:`${component.id} · ${component.label}（净峰）`,type:'scatter',mode:'lines',
          line:{...componentLine(component.id),width:highlighted?3:1.5},opacity:props.selectedPeak&&!highlighted ? .35 : 1});
      }
      traces.push({x:result.x,y:result.residuals,name:'残差 = 实测 − 拟合',type:'scatter',mode:'lines+markers',
        xaxis:'x2',yaxis:'y2',showlegend:false,line:{color:FIGURE_COLORS.residual,width:1},marker:{size:3,color:FIGURE_COLORS.residual}});
    }
    const yRange=intensityRange(traces,Math.min(...range),Math.max(...range));
    const narrow=width<600;
    await Plotly.react(plot.value,traces,{
      ...figureLayout(width),width,height,autosize:false,
      margin:{l:narrow?64:78,r:20,t:props.fill?48:narrow?115:70,b:55},dragmode:'pan',
      uirevision:`${full.value}:${request.range_start}:${request.range_end}:${Boolean(result)}:${resetVersion.value}`,
      xaxis:{...figureAxis(result?'':xLabel.value),range,autorange:false,anchor:'y',showticklabels:!result},
      yaxis:{...figureAxis('强度（原数据单位）'),domain:result?[.3,1]:[0,1],range:yRange,autorange:!yRange},
      ...(result?{
        xaxis2:{...figureAxis(xLabel.value),range,autorange:false,anchor:'y2',matches:'x'},
        yaxis2:{...figureAxis('残差'),domain:[0,.17],anchor:'x2',nticks:3},
        shapes:[{type:'line',xref:'paper',yref:'y2',x0:0,x1:1,y0:0,y1:0,line:{color:FIGURE_COLORS.reference,width:1,dash:'dash'}}],
      }:{}),
    },{...PLOTLY_CHINESE_CONFIG,displaylogo:false,modeBarButtonsToRemove:['select2d','lasso2d']});
    error.value='';
  }catch(e){error.value=`图表绘制失败：${e instanceof Error?e.message:String(e)}`;}
  finally{
    drawing=false;
    if(disposed)Plotly.purge(node);
    else if(redraw){redraw=false;void draw();}
  }
}
async function download(){
  if(!plot.value)return;
  try{await Plotly.downloadImage(plot.value,{format:'png',filename:'batch-spectrum',width:1400,height:900,scale:2});}
  catch(e){error.value=`图片导出失败：${e instanceof Error?e.message:String(e)}`;}
}
watch(()=>[props.request,props.preview,props.result,props.selectedPeak,props.fill,full.value,expanded.value,resetVersion.value],()=>nextTick(draw));
onMounted(()=>{
  void draw();
  if(typeof ResizeObserver!=='undefined'&&container.value){
    let width=container.value.clientWidth,height=container.value.clientHeight;
    observer=new ResizeObserver(entries=>{const size=entries[0]?.contentRect;if(!size)return;if(size.width!==width||size.height!==height){width=size.width;height=size.height;void nextTick(draw);}});observer.observe(container.value);
  }
});
onBeforeUnmount(()=>{disposed=true;observer?.disconnect();if(plot.value&&!drawing)Plotly.purge(plot.value);});
</script>

<template>
  <section class="panel batch-chart" :class="{'batch-chart-fill':fill,'is-expanded':fill&&expanded}" aria-label="当前谱线图表" @keydown.esc="expanded=false">
    <div class="batch-chart-toolbar">
      <h3>{{result?'拟合曲线与残差':'原谱与背景预览'}}</h3>
      <div class="xps-actions">
        <button :aria-pressed="!full" @click="full=false">拟合区间</button>
        <button :aria-pressed="full" @click="full=true" data-test="batch-chart-full">全谱</button>
        <button @click="resetVersion++" data-test="batch-chart-reset">复位</button>
        <button :aria-pressed="expanded" @click="expanded=!expanded">{{expanded?'收起图表':'放大图表'}}</button>
        <button @click="download">谱图 PNG</button>
      </div>
    </div>
    <p v-if="!result" class="hint">待拟合 · 当前显示原谱与预检背景</p>
    <p v-else class="hint">总拟合 = 背景 + 各净峰 · 残差 = 实测 − 拟合</p>
    <p v-if="error" role="alert" class="error">{{error}}</p>
    <div ref="container" class="batch-plot-container" :style="fill?undefined:{height:`${chartHeight}px`}"><div ref="plot" data-test="batch-plot" class="batch-plot" :style="{height:fill?'100%':`${chartHeight}px`}" :aria-label="result?'拟合曲线与残差图':'原谱与背景图'"/></div>
  </section>
</template>

<style scoped>
.batch-chart-toolbar{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.batch-chart h3{margin:0}.batch-plot{width:100%;min-width:0}.batch-plot-container{width:100%;min-width:0;margin-top:32px}.batch-chart-toolbar .xps-actions{margin:0}
.batch-chart-fill{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0;padding:12px;overflow:hidden}.batch-chart-fill .batch-plot-container{flex:1;min-height:0;margin-top:4px;overflow:hidden}.batch-chart-fill .batch-chart-toolbar{flex:none;gap:8px}.batch-chart-fill h3{font-size:13px}.batch-chart-fill .hint{margin:4px 0;font-size:12px}.batch-chart-fill button{height:30px;font-size:12px;padding:0 8px}.batch-chart-fill .xps-actions{gap:4px}.batch-chart-fill.is-expanded{position:fixed;inset:16px;z-index:100;box-shadow:0 0 0 100vmax #172b4670}.batch-chart-fill .error{flex:none}
button[aria-pressed=true]{background:var(--ui-selected);border-color:var(--ui-text)}
</style>
