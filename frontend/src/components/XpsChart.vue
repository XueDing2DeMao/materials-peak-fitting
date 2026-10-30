<script setup lang="ts">
import { spectrumViewport } from "../spectrumViewport";
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useAnalysisRange, analysisRangeShapes, rangeEndpointTrace } from '../useAnalysisRange';
import AnalysisRangeToolbar from './AnalysisRangeToolbar.vue';
import AnalysisRangeOverlay from './AnalysisRangeOverlay.vue';
import { pickX, nearestPeakAt } from "../chartPeakPick";
import { peakAnnotations, type AnnotatedPeak } from "../peakAnnotations";
import Plotly from "plotly.js-dist-min";
import { PLOTLY_CHINESE_CONFIG } from "../plotlyLocale";
import { figureAxis, figureLayout, FIGURE_COLORS } from "../figureStyle";
import { chartTraces } from "../xpsState";
import type { XpsPreview, XpsResult } from "../xpsTypes";
const props=defineProps<{selectedPeak?:string;readOnly?:boolean;components?:AnnotatedPeak[];x:number[];y:number[];shift:number;start:number;end:number;preview:XpsPreview|null;result:XpsResult|null}>();
const emit=defineEmits<{select:[id:string];range:[range:{start:number;end:number}];"add-peak":[x:number];"remove-peak":[id:string];"range-endpoint-focus":[endpoint:"start"|"end"]}>();
const plot=ref<HTMLElement|null>(null),residual=ref<HTMLElement|null>(null);
let userX:number[]|undefined,userY:number[]|undefined;
const toolsOpen=ref(false);
const displayMode=ref<'focus'|'full'>('focus'),viewRevision=ref(0);
function setDisplay(mode:'focus'|'full'){userX=undefined;userY=undefined;displayMode.value=mode;viewRevision.value++;void nextTick(draw);}
const addingPeak=ref(false);
const shifted=computed(()=>props.x.map(v=>v+props.shift));
const {selectionMode,rangeEditing,displayedRange,rangeOverlay,reversed,startVisible,endVisible,rangeEndpointPoints,scheduleRangeOverlay,
  beginRangeDrag,toggleRangeEditing,toggleRangeSelection,leaveRangeSelection,restoreRangeControls,selectRange,suspend} = useAnalysisRange({
  chart:plot,x:()=>shifted.value,y:()=>props.y,range:()=>({start:props.start,end:props.end}),change:range=>emit('range',range),redraw:draw,readOnly:()=>Boolean(props.readOnly),
});
function browse(){addingPeak.value=false;pressPoint=null;suspend();}
function toggleAddPeak(){suspend();addingPeak.value=!addingPeak.value;pressPoint=null;}
function editRange(){addingPeak.value=false;pressPoint=null;toggleRangeEditing();}
function selectAnalysisRange(){addingPeak.value=false;pressPoint=null;toolsOpen.value=false;toggleRangeSelection();}
function restoreControls(){if(props.readOnly||addingPeak.value)return;addingPeak.value=false;pressPoint=null;restoreRangeControls();}
let pressPoint:{x:number;y:number;pointerId:number;button:number;moved:boolean}|null=null;
function pickStart(e:PointerEvent){
  if(props.readOnly||!addingPeak.value||![0,2].includes(e.button)||!plot.value||pickX(plot.value,e.clientX,e.clientY)===null)return;
  e.preventDefault();e.stopImmediatePropagation();pressPoint={x:e.clientX,y:e.clientY,pointerId:e.pointerId,button:e.button,moved:false};
}
function pickMove(e:PointerEvent){if(pressPoint&&e.pointerId===pressPoint.pointerId&&Math.hypot(e.clientX-pressPoint.x,e.clientY-pressPoint.y)>5)pressPoint.moved=true;}
function pickEnd(e:PointerEvent){
  if(props.readOnly||!addingPeak.value||!pressPoint||!plot.value||e.pointerId!==pressPoint.pointerId||e.button!==pressPoint.button)return;
  e.preventDefault();e.stopImmediatePropagation();const down=pressPoint;pressPoint=null;
  if(down.moved||Math.hypot(e.clientX-down.x,e.clientY-down.y)>5)return;
  if(down.button===2){
    const id=nearestPeakAt(plot.value,e.clientX,e.clientY,props.result?.components??props.components??[],props.start,props.end);
    if(id)emit('remove-peak',id);
    return;
  }
  const x=pickX(plot.value,e.clientX,e.clientY);
  if(x!==null&&x>=props.start&&x<=props.end)emit('add-peak',x);
}
function suppressPeakMenu(e:MouseEvent){if(!props.readOnly&&addingPeak.value){e.preventDefault();e.stopImmediatePropagation();}}
let disposed=false, drawing=false, redraw=false;
let sizeObserver: ResizeObserver | undefined;
type ChartNode = HTMLElement & {
  _fullLayout?: { xaxis?: { range?: number[] };yaxis?:{range?:number[]} };
  on?: (event:string, fn:(event:any)=>void)=>void;
  removeAllListeners?: (event:string)=>void;
};
function xRange(node:HTMLElement|null):number[]|undefined {
  const range=(node as ChartNode|null)?._fullLayout?.xaxis?.range;
  return range?.length===2&&range.every(Number.isFinite)?[...range]:undefined;
}
async function alignXAxis(source:HTMLElement|null,target:HTMLElement|null){
  if(disposed||!source||!target)return;
  const range=xRange(source),current=xRange(target);
  // 相同范围不再触发 relayout，避免上下图互相回传形成循环。
  if(range&&(!current||range.some((value,i)=>value!==current[i])))
    await Plotly.relayout(target,{'xaxis.range':range,'xaxis.autorange':false});
}
async function syncXAxis(event:Record<string,unknown>,fromResidual=false){
  if(disposed||drawing||!plot.value||!residual.value||!event||
    !Object.keys(event).some(key=>key==='xaxis.autorange'||key.startsWith('xaxis.range')))return;
  if(event['xaxis.autorange']&&displayMode.value==='focus'){
    userX=undefined;
    await Plotly.relayout(plot.value,{'xaxis.range':[props.end,props.start],'xaxis.autorange':false});
    userX=undefined;
    await alignXAxis(plot.value,residual.value);
  }else if(fromResidual&&event['xaxis.autorange']){
    userX=undefined;
    await Plotly.relayout(plot.value,{'xaxis.autorange':'reversed'});
    await alignXAxis(plot.value,residual.value);
  }else{
    userX=xRange(fromResidual?residual.value:plot.value);
    await alignXAxis(fromResidual?residual.value:plot.value,fromResidual?plot.value:residual.value);
  }
}
async function draw(){
  if(!plot.value||!residual.value||disposed)return;
  if(drawing){redraw=true;return;}drawing=true;
  try{
    (plot.value as ChartNode).removeAllListeners?.('plotly_relayout');
    (residual.value as ChartNode).removeAllListeners?.('plotly_relayout');
    const markers=peakAnnotations(props.result?.components??props.components??[],props.start,props.end,' eV');
    const traces:Array<Record<string,unknown>>=chartTraces(shifted.value,props.y,props.preview,props.result);
    const viewport=displayMode.value==='focus'?spectrumViewport(traces,props.start,props.end,true):null;
    const visiblePeaks=((props.result?.components??props.components??[]) as AnnotatedPeak[]).filter(p=>p.enabled!==false&&Number.isFinite(p.parameters.xc?.value)&&p.parameters.xc!.value>=props.start&&p.parameters.xc!.value<=props.end);
    markers.shapes.forEach((shape,i)=>{if(props.selectedPeak)shape.line.width=visiblePeaks[i]?.id===props.selectedPeak?2.5:1;});
    const layout={...figureLayout(plot.value.clientWidth),width:plot.value.clientWidth||undefined,margin:{autoexpand:false,l:68,r:18,t:plot.value.clientWidth<400?110:64,b:48},height:plot.value.clientHeight || 360,dragmode:addingPeak.value?false:selectionMode.value?"select":"pan",selectdirection:"h",selections:[],selectionrevision:String(selectionMode.value),
      xaxis:{...figureAxis("结合能 / eV"),autorange:userX||viewport?false:"reversed",range:userX??viewport?.x},yaxis:{...figureAxis("强度（原数据单位）"),autorange:!userY&&!viewport?.y,range:userY??viewport?.y},
      uirevision:`${displayMode.value}-${viewRevision.value}-${props.x[0]}-${props.x.length}-${props.shift}`,
      annotations:markers.annotations,
      shapes:[...analysisRangeShapes(displayedRange.value),...markers.shapes]};

    for(const [i,c] of (props.result?.components??[]).entries()){const trace=traces[traces.length-props.result!.components.length+i];trace.meta={peakId:c.id};if(props.selectedPeak){trace.opacity=c.id===props.selectedPeak?1:.25;trace.line={...(trace.line as object),width:c.id===props.selectedPeak?3.5:1.2};}}

    if(rangeEndpointPoints.value.length===2)traces.push(rangeEndpointTrace(rangeEndpointPoints.value));
    await Plotly.react(plot.value,traces,layout,{...PLOTLY_CHINESE_CONFIG,editable:false,doubleClick:addingPeak.value?false:'reset+autosize',modeBarButtonsToRemove:['select2d','lasso2d']});
    scheduleRangeOverlay();
    if(disposed)return;
    const el=plot.value as HTMLElement & {on:(event:string,fn:(e:any)=>void)=>void;removeAllListeners:(event:string)=>void};
    for(const event of ['plotly_selected','plotly_relayout','plotly_click','plotly_doubleclick','plotly_deselect'])el.removeAllListeners(event);
    el.on('plotly_selected',selectRange);
    el.on('plotly_relayout',(event)=>{if(Object.keys(event??{}).some(k=>k.startsWith('yaxis.range')))userY=(plot.value as ChartNode)?._fullLayout?.yaxis?.range;if(event?.['yaxis.autorange'])userY=undefined;scheduleRangeOverlay();void syncXAxis(event);});
    el.on('plotly_doubleclick',restoreControls);
    el.on('plotly_deselect',leaveRangeSelection);
    el.on('plotly_click',(event:any)=>{
      if(props.readOnly||addingPeak.value)return;
      if(selectionMode.value){leaveRangeSelection();return;}
      const point=event?.points?.[0];
      if(point?.data?.meta?.peakId){emit('select',point.data.meta.peakId);return;}
      if(point?.data?.name==='分析区间端点'&&['start','end'].includes(point.customdata))emit('range-endpoint-focus',point.customdata);
    });
    await Plotly.react(residual.value,props.result?[{x:props.result.x,y:props.result.residuals,type:"scatter",mode:"lines+markers",name:"残差 = 实测 − 拟合",line:{color:FIGURE_COLORS.residual,width:1,shape:"linear"},marker:{color:FIGURE_COLORS.residual,size:3.5,opacity:0.8},connectgaps:false}]:[],
      {...figureLayout(),width:residual.value.clientWidth||undefined,height:residual.value.clientHeight || 180,margin:{autoexpand:false,l:68,r:18,t:12,b:42},xaxis:{...figureAxis("结合能 / eV"),range:xRange(plot.value),autorange:xRange(plot.value)?false:"reversed"},uirevision:layout.uirevision,yaxis:{...figureAxis("残差"),nticks:3},showlegend:false,shapes:[{type:"line",xref:"paper",x0:0,x1:1,y0:0,y1:0,layer:"below",line:{color:FIGURE_COLORS.reference,width:1,dash:"dash"}}]}, PLOTLY_CHINESE_CONFIG);
    (residual.value as ChartNode).on?.('plotly_relayout',(event)=>void syncXAxis(event,true));
  }finally{drawing=false;if(redraw){redraw=false;await draw();}}
}
watch(()=>[props.x,props.y,props.shift],()=>{userX=undefined;userY=undefined;viewRevision.value++;},{flush:'sync'});
watch(()=>[props.selectedPeak,props.x,props.y,props.shift,props.start,props.end,props.preview,props.result,props.components,selectionMode.value,addingPeak.value],()=>nextTick(draw),{deep:true});
onMounted(() => {
  void draw();
  if (typeof ResizeObserver !== "undefined" && plot.value) {
    const sizes=new WeakMap<Element,string>();
    sizeObserver = new ResizeObserver(entries => {
      let changed=false;
      for(const entry of entries){const {width,height}=entry.contentRect,key=`${width}:${height}`;if(sizes.get(entry.target)!==key){sizes.set(entry.target,key);if(width>0&&height>0)changed=true;}}
      if(changed)void nextTick(draw);
    });
    sizeObserver.observe(plot.value);if(residual.value)sizeObserver.observe(residual.value);
  }
});onActivated(()=>nextTick(draw));onBeforeUnmount(()=>{disposed=true;sizeObserver?.disconnect();if(plot.value)Plotly.purge(plot.value);if(residual.value)Plotly.purge(residual.value);});
defineExpose({downloadImage:()=>plot.value&&Plotly.downloadImage(plot.value,{format:"png",filename:"xps-fit",width:1400,height:800,scale:2})});
</script>
<template><section class="chart-stack xps-chart" :class="{'tools-open':toolsOpen}" tabindex="0" @keydown.esc="browse"><div class="chart-heading"><h2>XPS 谱线与分量</h2><p class="hint">总拟合 = 背景 + 各净峰 · 结合能倒序</p></div><div class="spectrum-view-tools" role="group" aria-label="谱线显示范围"><button type="button" :aria-pressed="displayMode==='focus'" data-test="spectrum-focus" @click="setDisplay('focus')">聚焦拟合区间</button><button type="button" :aria-pressed="displayMode==='full'" data-test="spectrum-full" @click="setDisplay('full')">全谱视图</button><button type="button" data-test="spectrum-reset" @click="setDisplay(displayMode)">复位</button><button type="button" class="compact-chart-tools-toggle" :aria-expanded="toolsOpen" @click="toolsOpen=!toolsOpen">编辑工具</button></div><div class="chart-tools"><AnalysisRangeToolbar v-if="x.length" :range="displayedRange" :range-editing="rangeEditing" :selection-mode="selectionMode" :read-only="readOnly" @edit="editRange" @select="selectAnalysisRange" />
<div v-if="!readOnly" class="xps-actions"><button :aria-pressed="addingPeak" :disabled="!x.length" @click="toggleAddPeak" data-test="chart-add-peak">{{addingPeak?'取消添加峰':'图上添加峰'}}</button></div>
</div><div v-if="x.length&&!readOnly" class="chart-mode-status"><span role="status">当前模式：{{addingPeak?'添加峰':selectionMode?'框选分析区间':rangeEditing?'调整分析区间':'浏览'}}<span v-if="selectionMode" data-test="range-selection-guide" class="range-selection-guide"> · 水平拖动，松开后更新区间。</span></span><button v-if="addingPeak||selectionMode||rangeEditing" type="button" @click="browse" data-test="chart-browse">结束编辑 · 返回浏览</button></div>
<p v-if="addingPeak" class="hint" role="status">左键添加峰，右键点峰位标记删除；Esc 退出。</p>
<p v-if="components?.some(p=>p.enabled!==false)||result?.components.length" class="hint" data-test="peak-marker-caption">峰位标注：{{ result ? "拟合结果 xc" : "当前初值 xc" }}</p><div class="chart-canvas"><div v-if="!x.length" class="chart-empty"><strong>等待实验谱线</strong><span>导入数据并应用 X / Y 列，在此核对原谱、背景与拟合分量。</span></div><div ref="plot" @dblclick="restoreControls" class="xps-plot" :style="{cursor:addingPeak?'crosshair':undefined}" @contextmenu.capture="suppressPeakMenu" @pointerdown.capture="pickStart" @pointerup.capture="pickEnd" @pointermove.capture="pickMove" @pointerleave="pressPoint=null" @pointercancel="pressPoint=null" data-test="xps-plot"/><AnalysisRangeOverlay v-if="!readOnly" :geometry="rangeOverlay" :range="displayedRange" :range-editing="rangeEditing" :selection-mode="selectionMode" :reversed="reversed" :start-visible="startVisible" :end-visible="endVisible" @drag="beginRangeDrag" /></div><div ref="residual" class="xps-residual" role="img" aria-label="残差图" data-test="xps-residual"/></section></template>
