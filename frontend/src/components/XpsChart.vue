<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Plotly from "plotly.js-dist-min";
import { PLOTLY_CHINESE_CONFIG } from "../plotlyLocale";
import { figureAxis, figureLayout, FIGURE_COLORS } from "../figureStyle";
import { chartTraces } from "../xpsState";
import type { XpsPreview, XpsResult } from "../xpsTypes";
const props=defineProps<{x:number[];y:number[];shift:number;start:number;end:number;preview:XpsPreview|null;result:XpsResult|null}>();
const emit=defineEmits<{range:[range:{start:number;end:number}]}>();
const plot=ref<HTMLElement|null>(null),residual=ref<HTMLElement|null>(null);
const interaction=ref<"select"|"range"|"pan">("select");
const shifted=computed(()=>props.x.map(v=>v+props.shift));
let disposed=false, drawing=false, redraw=false;
let sizeObserver: ResizeObserver | undefined;
async function draw(){
  if(!plot.value||!residual.value||disposed)return;
  if(drawing){redraw=true;return;}drawing=true;
  try{
    const layout={...figureLayout(),margin:{l:76,r:24,t:80,b:52},height:plot.value.clientHeight || 360,dragmode:interaction.value==="select"?"select":"pan",selectdirection:"h",
      xaxis:{...figureAxis("结合能 / eV"),autorange:"reversed"},yaxis:figureAxis("强度（原数据单位）"),
      uirevision:`${props.x[0]}-${props.x.length}-${props.shift}`,
      shapes:[{type:"rect",xref:"x",yref:"paper",x0:props.start,x1:props.end,y0:0,y1:1,layer:"below",line:{color:FIGURE_COLORS.reference,width:1,dash:"dot"},fillcolor:"rgba(80,80,80,.035)",editable:interaction.value==="range"}]};
    await Plotly.react(plot.value,chartTraces(shifted.value,props.y,props.preview,props.result),layout,{...PLOTLY_CHINESE_CONFIG,edits:{shapePosition:interaction.value==="range"}});
    if(disposed)return;
    const el=plot.value as HTMLElement & {on:(event:string,fn:(e:any)=>void)=>void;removeAllListeners:(event:string)=>void};
    el.removeAllListeners("plotly_selected");el.removeAllListeners("plotly_relayout");
    el.on("plotly_selected",(e:any)=>{if(interaction.value==="select"&&e?.range?.x){const [a,b]=e.range.x;emit("range",{start:Math.min(a,b),end:Math.max(a,b)});}});
    el.on("plotly_relayout",(e:any)=>{if(e["shapes[0].x0"]!==undefined||e["shapes[0].x1"]!==undefined){const a=e["shapes[0].x0"]??props.start,b=e["shapes[0].x1"]??props.end;if(Number.isFinite(a)&&Number.isFinite(b)&&a!==b)emit("range",{start:Math.min(a,b),end:Math.max(a,b)});}});
    await Plotly.react(residual.value,props.result?[{x:props.result.x,y:props.result.residuals,type:"scatter",mode:"markers",name:"残差 = 实测 − 拟合",marker:{color:FIGURE_COLORS.residual,size:3.5,opacity:0.8}}]:[],
      {...figureLayout(),height:residual.value.clientHeight || 160,margin:{l:76,r:24,t:16,b:52},xaxis:{...figureAxis("结合能 / eV"),autorange:"reversed"},yaxis:{...figureAxis("残差"),nticks:3},showlegend:false,shapes:[{type:"line",xref:"paper",x0:0,x1:1,y0:0,y1:0,layer:"below",line:{color:FIGURE_COLORS.reference,width:1,dash:"dash"}}]}, PLOTLY_CHINESE_CONFIG);
  }finally{drawing=false;if(redraw){redraw=false;await draw();}}
}
watch(()=>[props.x,props.y,props.shift,props.start,props.end,props.preview,props.result,interaction.value],()=>nextTick(draw),{deep:true});
onMounted(() => {
  void draw();
  if (typeof ResizeObserver !== "undefined" && plot.value) {
    let previousWidth = 0;
    sizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && width !== previousWidth) { previousWidth = width; void nextTick(draw); }
    });
    sizeObserver.observe(plot.value);
  }
});onActivated(()=>nextTick(draw));onBeforeUnmount(()=>{disposed=true;sizeObserver?.disconnect();if(plot.value)Plotly.purge(plot.value);if(residual.value)Plotly.purge(residual.value);});
defineExpose({downloadImage:()=>plot.value&&Plotly.downloadImage(plot.value,{format:"png",filename:"xps-fit",width:1400,height:800,scale:2})});
</script>
<template><section class="chart-stack xps-chart"><div class="chart-heading"><h2>XPS 谱线与分量</h2><p class="hint">总拟合 = 固定背景 + 各净峰；结合能倒序显示。</p></div><div class="xps-range-readout">拟合区间 {{ start.toFixed(3) }} — {{ end.toFixed(3) }} eV <span>{{interaction==='select'?'水平拖动框选区间。':interaction==='range'?'拖动区域或边界调整区间。':'平移、缩放不改变分析区间。'}}</span></div><div class="xps-actions"><button :aria-pressed="interaction==='select'" @click="interaction='select'">框选区间</button><button :aria-pressed="interaction==='range'" @click="interaction='range'">拖动区间</button><button :aria-pressed="interaction==='pan'" @click="interaction='pan'">平移视图</button></div><div ref="plot" class="xps-plot" data-test="xps-plot"/><h3>残差</h3><div ref="residual" class="xps-residual" data-test="xps-residual"/></section></template>
