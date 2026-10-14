import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch, type Ref } from 'vue';
import { FIGURE_FONT, FIGURE_TEXT } from './figureStyle';
import type { Anchor } from './types';
export type AnalysisRange = { start: number; end: number };
export function formatAxisValue(value: number): string { return Number(value).toPrecision(6); }

/** 单峰、多峰和 XPS 共用同一组选择、边界拖动与视图同步行为。 */
export function useAnalysisRange(options: {
  chart: Ref<HTMLElement | null>; x: () => number[]; y: () => number[];
  range: () => AnalysisRange | null | undefined; change: (range: AnalysisRange) => void;
  redraw: () => unknown; readOnly?: () => boolean;
}) {
const chart = options.chart;
let active = true;
const selectionMode = ref(false);
const rangeEditing = ref(false);

type RangeOverlay = { left: number; top: number; width: number; height: number };
type RangeDragKind = "start" | "end" | "move";
type PlotlyAxis = { _offset?: number; _length?: number; range?: [number, number] };
type PlotlyChartNode = HTMLElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
  on?: (event: string, callback: (event: any) => void) => void;
  removeAllListeners?: (event: string) => void;
};
const rangeOverlay = ref<RangeOverlay | null>(null);
const reversed = ref(false);
const startVisible = ref(true), endVisible = ref(true);
const draggingRange = ref<AnalysisRange | null>(null);
const pendingRange = ref<AnalysisRange | null>(null);
const displayedRange = computed(() => draggingRange.value ?? pendingRange.value ?? options.range());
let activeRangeDrag: { kind: RangeDragKind; initial: AnalysisRange; startClientX: number; pointerId: number } | null = null;
let rangeOverlayFrame: number | null = null;


function isAnalysisRange(value: AnalysisRange | null | undefined): value is AnalysisRange {
  if (!value) return false;
  return Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start;
}
const finiteDataExtent = computed<AnalysisRange | null>(() => {
  let start = Infinity; let end = -Infinity;
  for (const value of options.x()) {
    if (!Number.isFinite(value)) continue;
    start = Math.min(start, value); end = Math.max(end, value);
  }
  return end > start ? { start, end } : null;
});
function dataExtent(): AnalysisRange | null { return finiteDataExtent.value; }
const rangeOverlayStyle = computed(() => {
  if (!rangeOverlay.value) return {};
  const { left, top, width, height } = rangeOverlay.value;
  return { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` };
});
function syncRangeOverlay(): void {
  const range = displayedRange.value;
  if (!chart.value || !isAnalysisRange(range)) { rangeOverlay.value = null; return; }
  const node = chart.value as PlotlyChartNode;
  const xAxis = node._fullLayout?.xaxis;
  const yAxis = node._fullLayout?.yaxis;
  const width = chart.value.clientWidth || 640;
  const height = chart.value.clientHeight || 360;
  const hasAxisGeometry = Number.isFinite(xAxis?._offset) && Number.isFinite(xAxis?._length)
    && Number.isFinite(yAxis?._offset) && Number.isFinite(yAxis?._length)
    && Array.isArray(xAxis?.range) && Number.isFinite(xAxis.range[0]) && Number.isFinite(xAxis.range[1])
    && xAxis.range[0] !== xAxis.range[1];
  if (hasAxisGeometry && xAxis && yAxis) {
    const [axisStart, axisEnd] = xAxis.range!;
    reversed.value = axisStart > axisEnd;
    const project = (value: number) => Number(xAxis._offset) + ((value - axisStart) / (axisEnd - axisStart)) * Number(xAxis._length);
    const start = project(range.start); const end = project(range.end);
    const plotLeft = Number(xAxis._offset), plotRight = plotLeft + Number(xAxis._length);
    startVisible.value = start >= plotLeft && start <= plotRight;
    endVisible.value = end >= plotLeft && end <= plotRight;
    const left = Math.max(plotLeft, Math.min(start, end)), right = Math.min(plotRight, Math.max(start, end));
    rangeOverlay.value = right > left ? { left, top: Number(yAxis._offset), width: right-left, height: Number(yAxis._length) } : null;
    return;
  }
  reversed.value = false;startVisible.value = true;endVisible.value = true;
  const extent = dataExtent();
  if (!extent) { rangeOverlay.value = null; return; }
  const margin = { left: 84, right: 24, top: width < 400 ? 120 : 80, bottom: 60 };
  const plotWidth = Math.max(120, width - margin.left - margin.right);
  const project = (value: number) => margin.left + ((value - extent.start) / (extent.end - extent.start)) * plotWidth;
  const start = project(range.start); const end = project(range.end);
  rangeOverlay.value = { left: Math.min(start, end), top: margin.top, width: Math.max(1, Math.abs(end - start)), height: Math.max(120, height - margin.top - margin.bottom) };
}
function scheduleRangeOverlay(): void {
  syncRangeOverlay();
  if (typeof window === "undefined" || rangeOverlayFrame !== null) return;
  rangeOverlayFrame = window.requestAnimationFrame(() => {
    rangeOverlayFrame = null;
    syncRangeOverlay();
  });
}
function dataValueForClientX(clientX: number): number | null {
  if (!chart.value) return null;
  const node = chart.value as PlotlyChartNode;
  const axis = node._fullLayout?.xaxis;
  const rect = chart.value.getBoundingClientRect();
  if (axis && Number.isFinite(axis._offset) && Number.isFinite(axis._length) && Array.isArray(axis.range) && axis._length && axis.range[0] !== axis.range[1]) {
    const pixel = Math.min(Math.max(clientX - rect.left - Number(axis._offset), 0), Number(axis._length));
    return axis.range[0] + (pixel / Number(axis._length)) * (axis.range[1] - axis.range[0]);
  }
  const extent = dataExtent();
  const overlay = rangeOverlay.value;
  if (!extent || !overlay) return null;
  const width = chart.value.clientWidth || 640;
  const plotWidth = Math.max(120, width - 84);
  const pixel = Math.min(Math.max(clientX - rect.left - 58, 0), plotWidth);
  return extent.start + (pixel / plotWidth) * (extent.end - extent.start);
}
function updateRangeDrag(event: PointerEvent): void {
  if (!activeRangeDrag || event.pointerId !== activeRangeDrag.pointerId) return;
  if (event.cancelable) event.preventDefault();
  const pointerValue = dataValueForClientX(event.clientX);
  const extent = dataExtent();
  if (!Number.isFinite(pointerValue) || !extent) return;
  const { kind, initial } = activeRangeDrag;
  // 按当前区间限制最小宽度，避免全数据跨度把局部窄区间挤出边界。
  const minGap = Math.min((initial.end - initial.start) / 1000, Math.max((extent.end - extent.start) / 1000, Number.EPSILON));
  let next: AnalysisRange;
  if (kind === "start") next = { start: Math.min(Math.max(pointerValue!, extent.start), initial.end - minGap), end: initial.end };
  else if (kind === "end") next = { start: initial.start, end: Math.max(Math.min(pointerValue!, extent.end), initial.start + minGap) };
  else {
    let start = initial.start + (pointerValue! - dataValueForClientX(activeRangeDrag.startClientX)!);
    let end = initial.end + (pointerValue! - dataValueForClientX(activeRangeDrag.startClientX)!);
    if (start < extent.start) { end += extent.start - start; start = extent.start; }
    if (end > extent.end) { start -= end - extent.end; end = extent.end; }
    next = { start, end };
  }
  draggingRange.value = next;
  syncRangeOverlay();
}
function finishRangeDrag(event: PointerEvent): void {
  if (!activeRangeDrag || event.pointerId !== activeRangeDrag.pointerId) return;
  const next = draggingRange.value;
  activeRangeDrag = null;
  window.removeEventListener("pointermove", updateRangeDrag);
  window.removeEventListener("pointerup", finishRangeDrag);
  window.removeEventListener("pointercancel", cancelRangeDrag);
  if (isAnalysisRange(next)) {
    // Keep this light-weight overlay alive for the one render turn in which the
    // parent is applying the emitted range and Plotly is redrawing its shapes.
    pendingRange.value = { ...next };
    options.change(next);
  }
  draggingRange.value = null;
  scheduleRangeOverlay();
}
function beginRangeDrag(kind: RangeDragKind, event: PointerEvent): void {
  if (!active || options.readOnly?.() || event.button !== 0) return;
  const range = displayedRange.value;
  if (!isAnalysisRange(range)) return;
  event.preventDefault();
  selectionMode.value = false;
  rangeEditing.value = true;
  activeRangeDrag = { kind, initial: { ...range }, startClientX: event.clientX, pointerId: event.pointerId };
  draggingRange.value = { ...range };
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", updateRangeDrag);
  window.addEventListener("pointerup", finishRangeDrag);
  window.addEventListener("pointercancel", cancelRangeDrag);
}
function cancelRangeDrag(event: PointerEvent): void {
  if (!activeRangeDrag || event.pointerId !== activeRangeDrag.pointerId) return;
  stopActiveRangeDrag();scheduleRangeOverlay();
}
function stopActiveRangeDrag(): void {
  activeRangeDrag = null;
  draggingRange.value = null;
  window.removeEventListener("pointermove", updateRangeDrag);
  window.removeEventListener("pointerup", finishRangeDrag);
  window.removeEventListener("pointercancel", cancelRangeDrag);
}
function endRangeEditing(): void {
  rangeEditing.value = false;
  stopActiveRangeDrag();
  scheduleRangeOverlay();
}
function toggleRangeEditing(): void {
  if (!active || options.readOnly?.()) return;
  if (rangeEditing.value) {
    endRangeEditing();
    return;
  }
  selectionMode.value = false;
  rangeEditing.value = true;
  void nextTick(() => {
    options.redraw();
    scheduleRangeOverlay();
  });
}
function toggleRangeSelection(): void {
  if (!active || options.readOnly?.()) return;
  stopActiveRangeDrag();
  if (!selectionMode.value) rangeEditing.value = false;
  selectionMode.value = !selectionMode.value;
  nextTick(options.redraw);
}
function leaveRangeSelection(): void {
  if (!selectionMode.value) return;
  selectionMode.value = false;
  nextTick(options.redraw);
}
function restoreRangeControls(): void {
  if (!active || options.readOnly?.()) return;
  leaveRangeSelection();
  rangeEditing.value = true;
  pendingRange.value = null;
  // Plotly may reset its axes after a double-click.  Run after Vue has removed
  // the selection layer, then schedule one more geometry pass for that reset.
  void nextTick(() => scheduleRangeOverlay());
}
function handleRangeEditorKeydown(event: KeyboardEvent): void {
  if (!active || event.key !== "Escape") return;
  leaveRangeSelection();
  endRangeEditing();
}
function nearestDataPoint(targetX: number): Anchor | null {
  let nearest: Anchor | null = null;
  let nearestDistance = Infinity;
  options.x().forEach((x, index) => {
    const y = options.y()[index];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const distance = Math.abs(x - targetX);
    if (distance < nearestDistance) { nearest = { x, y }; nearestDistance = distance; }
  });
  return nearest;
}
const rangeEndpointPoints = computed(() => {
  const range = displayedRange.value;
  if (!isAnalysisRange(range)) return [];
  const start = nearestDataPoint(range.start); const end = nearestDataPoint(range.end);
  return start && end ? [
    { ...start, endpoint: "start" as const, label: `起点 ${formatAxisValue(start.x)}` },
    { ...end, endpoint: "end" as const, label: `终点 ${formatAxisValue(end.x)}` },
  ] : [];
});

function selectRange(event: {points?: Array<{x: number}>} | null) {
  if (!active || options.readOnly?.() || !selectionMode.value) return;
  const selected = (event?.points ?? []).map(p=>p.x).filter(Number.isFinite);
  if (selected.length >= 2) {
    const range = {start: Math.min(...selected), end: Math.max(...selected)};
    if (isAnalysisRange(range)) options.change(range);
  }
  leaveRangeSelection();
}
function suspend() { leaveRangeSelection(); endRangeEditing(); }
onMounted(()=>{window.addEventListener('resize',scheduleRangeOverlay);window.addEventListener('keydown',handleRangeEditorKeydown);});
onActivated(()=>{active=true;void nextTick(scheduleRangeOverlay);});
onDeactivated(()=>{active=false;suspend();});
watch(()=>options.range(),range=>{if(pendingRange.value&&isAnalysisRange(range))pendingRange.value=null;},{deep:true});
watch(()=>options.x(),()=>{pendingRange.value=null;stopActiveRangeDrag();});
onBeforeUnmount(()=>{
  active=false;stopActiveRangeDrag();
  window.removeEventListener('resize',scheduleRangeOverlay);window.removeEventListener('keydown',handleRangeEditorKeydown);
  if(rangeOverlayFrame!==null)window.cancelAnimationFrame(rangeOverlayFrame);
});
return {selectionMode,rangeEditing,displayedRange,rangeOverlay,rangeOverlayStyle,reversed,startVisible,endVisible,rangeEndpointPoints,
  scheduleRangeOverlay,beginRangeDrag,toggleRangeEditing,toggleRangeSelection,leaveRangeSelection,restoreRangeControls,selectRange,suspend};
}

export function analysisRangeShapes(range: AnalysisRange | null | undefined): object[] {
  if(!range||!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.end<=range.start)return [];
  return [
    {type:'rect',xref:'x',x0:range.start,x1:range.end,yref:'paper',y0:0,y1:1,layer:'below',editable:false,line:{width:0},fillcolor:'rgba(80,80,80,.035)'},
    ...(['start','end'] as const).map(endpoint=>({type:'line',xref:'x',x0:range[endpoint],x1:range[endpoint],yref:'paper',y0:0,y1:1,editable:false,line:{color:endpoint==='start'?'#087b79':'#236a9a',width:1,dash:'dot'}})),
  ];
}
export function rangeEndpointTrace(points: Array<{x:number;y:number;endpoint:'start'|'end';label:string}>) {
  return {x:points.map(p=>p.x),y:points.map(p=>p.y),type:'scatter',mode:'markers',name:'分析区间端点',
    text:points.map(p=>p.label),textposition:['top right','top left'],textfont:{color:'#315f70',size:FIGURE_TEXT.annotation,family:FIGURE_FONT},
    customdata:points.map(p=>p.endpoint),marker:{color:['#087b79','#236a9a'],size:11,symbol:'circle',line:{color:'#fff',width:2}},hovertemplate:'%{text}<br>Y = %{y:.6g}<extra></extra>',cliponaxis:false,showlegend:false};
}
