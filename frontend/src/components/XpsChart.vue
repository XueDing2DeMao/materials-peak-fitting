<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Plotly from "plotly.js-dist-min";
import { chartTraces } from "../xpsState";
import type { XpsPreview, XpsResult } from "../xpsTypes";
const props=defineProps<{x:number[];y:number[];shift:number;start:number;end:number;preview:XpsPreview|null;result:XpsResult|null}>();
const emit=defineEmits<{range:[range:{start:number;end:number}]}>();
const plot=ref<HTMLElement|null>(null),residual=ref<HTMLElement|null>(null);
const interaction=ref<"select"|"range"|"pan">("select");
const shifted=computed(()=>props.x.map(v=>v+props.shift));
let disposed=false, drawing=false, redraw=false;
async function draw(){
  if(!plot.value||!residual.value||disposed)return;
  if(drawing){redraw=true;return;}drawing=true;
  try{
    const layout={margin:{l:64,r:18,t:22,b:55},height:450,dragmode:interaction.value==="select"?"select":"pan",selectdirection:"h",
      xaxis:{title:{text:"结合能 / eV"},autorange:"reversed"},yaxis:{title:{text:"强度（原数据单位）"}},
      legend:{orientation:"h",y:1.18},uirevision:`${props.x[0]}-${props.x.length}-${props.shift}`,
      shapes:[{type:"rect",xref:"x",yref:"paper",x0:props.start,x1:props.end,y0:0,y1:1,line:{color:"#087b79",width:1},fillcolor:"rgba(8,123,121,.055)",editable:interaction.value==="range"}]};
    await Plotly.react(plot.value,chartTraces(shifted.value,props.y,props.preview,props.result),layout,{responsive:true,displaylogo:false,edits:{shapePosition:interaction.value==="range"}});
    if(disposed)return;
    const el=plot.value as HTMLElement & {on:(event:string,fn:(e:any)=>void)=>void;removeAllListeners:(event:string)=>void};
    el.removeAllListeners("plotly_selected");el.removeAllListeners("plotly_relayout");
    el.on("plotly_selected",(e:any)=>{if(interaction.value==="select"&&e?.range?.x){const [a,b]=e.range.x;emit("range",{start:Math.min(a,b),end:Math.max(a,b)});}});
    el.on("plotly_relayout",(e:any)=>{if(e["shapes[0].x0"]!==undefined||e["shapes[0].x1"]!==undefined){const a=e["shapes[0].x0"]??props.start,b=e["shapes[0].x1"]??props.end;if(Number.isFinite(a)&&Number.isFinite(b)&&a!==b)emit("range",{start:Math.min(a,b),end:Math.max(a,b)});}});
    await Plotly.react(residual.value,props.result?[{x:props.result.x,y:props.result.residuals,type:"scatter",mode:"lines",line:{color:"#536c86"}}]:[],
      {height:200,margin:{l:64,r:18,t:12,b:48},xaxis:{autorange:"reversed",title:{text:"结合能 / eV"}},yaxis:{title:{text:"观测 − 总拟合"},zeroline:true,zerolinecolor:"#c77d23"}}, {responsive:true,displaylogo:false});
  }finally{drawing=false;if(redraw){redraw=false;await draw();}}
}
watch(()=>[props.x,props.y,props.shift,props.start,props.end,props.preview,props.result,interaction.value],()=>nextTick(draw),{deep:true});
onMounted(draw);onActivated(()=>nextTick(draw));onBeforeUnmount(()=>{disposed=true;if(plot.value)Plotly.purge(plot.value);if(residual.value)Plotly.purge(residual.value);});
defineExpose({downloadImage:()=>plot.value&&Plotly.downloadImage(plot.value,{format:"png",filename:"xps-fit",width:1400,height:800,scale:2})});
</script>
<template><section class="chart-stack xps-chart"><div class="chart-heading"><h2>XPS 谱线与分量</h2><p class="hint">结合能由高到低显示。各分量为净峰；总拟合 = 固定背景 + 所有净峰。</p></div><div class="xps-range-readout">拟合区间 {{ start.toFixed(3) }} — {{ end.toFixed(3) }} eV <span>{{interaction==='select'?'在图中水平拖动，框选分析区间。':interaction==='range'?'拖动浅色区域或其边界调整区间。':'平移或使用工具栏缩放；不会改变拟合区间。'}}</span></div><div class="xps-actions"><button :aria-pressed="interaction==='select'" @click="interaction='select'">框选区间</button><button :aria-pressed="interaction==='range'" @click="interaction='range'">拖动区间</button><button :aria-pressed="interaction==='pan'" @click="interaction='pan'">平移视图</button></div><div ref="plot" data-test="xps-plot"/><h3>残差</h3><div ref="residual" data-test="xps-residual"/></section></template>
