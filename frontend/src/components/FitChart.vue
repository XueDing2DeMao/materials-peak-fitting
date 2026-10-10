<script setup lang="ts">
import { overallWidthText } from "../peakGeometry";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Plotly from "plotly.js-dist-min";
import { peakModelInfo } from "../peakModels";
import { PLOTLY_CHINESE_CONFIG } from "../plotlyLocale";
import type { Anchor, BaselinePreview, FitResult } from "../types";
const props = withDefaults(defineProps<{
  x: number[];
  y: number[];
  result: FitResult | null;
  anchors: Anchor[];
  analysisRange?: { start: number; end: number } | null;
  baselinePreview: BaselinePreview | null;
  stale?: boolean;
  analysisMode?: "single" | "xrd";
}>(), { analysisRange: null, stale: false, analysisMode: "single" });
const isXrd = computed(() => props.analysisMode === "xrd");
const chartTitle = computed(() => isXrd.value ? "XRD 衍射峰拟合" : "光谱与单峰拟合");
const xAxisTitle = computed(() => isXrd.value ? "2θ（°）" : "X");
const widthUnit = computed(() => isXrd.value ? "°" : "");
const emit = defineEmits<{
  anchor: [point: Anchor];
  range: [range: { start: number; end: number }];
  "range-endpoint-focus": [endpoint: "start" | "end"];
}>();
const chart = ref<HTMLDivElement | null>(null); const residualChart = ref<HTMLDivElement | null>(null);
const selectionMode = ref(false);
const rangeEditing = ref(false);
type AnalysisRange = { start: number; end: number };
type RangeOverlay = { left: number; top: number; width: number; height: number };
type RangeDragKind = "start" | "end" | "move";
type PlotlyAxis = { _offset?: number; _length?: number; range?: [number, number] };
type PlotlyChartNode = HTMLDivElement & {
  _fullLayout?: { xaxis?: PlotlyAxis; yaxis?: PlotlyAxis };
  on?: (event: string, callback: (event: any) => void) => void;
  removeAllListeners?: (event: string) => void;
};
const rangeOverlay = ref<RangeOverlay | null>(null);
const draggingRange = ref<AnalysisRange | null>(null);
const pendingRange = ref<AnalysisRange | null>(null);
const displayedRange = computed(() => draggingRange.value ?? pendingRange.value ?? props.analysisRange);
let activeRangeDrag: { kind: RangeDragKind; initial: AnalysisRange; startClientX: number } | null = null;
let rangeOverlayFrame: number | null = null;
function formatAxisValue(value: number): string { return Number(value).toPrecision(6); }
function isAnalysisRange(value: AnalysisRange | null | undefined): value is AnalysisRange {
  if (!value) return false;
  return Number.isFinite(value.start) && Number.isFinite(value.end) && value.end > value.start;
}
const finiteDataExtent = computed<AnalysisRange | null>(() => {
  let start = Infinity; let end = -Infinity;
  for (const value of props.x) {
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
  const height = chart.value.clientHeight || 460;
  const hasAxisGeometry = Number.isFinite(xAxis?._offset) && Number.isFinite(xAxis?._length)
    && Number.isFinite(yAxis?._offset) && Number.isFinite(yAxis?._length)
    && Array.isArray(xAxis?.range) && Number.isFinite(xAxis.range[0]) && Number.isFinite(xAxis.range[1])
    && xAxis.range[0] !== xAxis.range[1];
  if (hasAxisGeometry && xAxis && yAxis) {
    const [axisStart, axisEnd] = xAxis.range!;
    const project = (value: number) => Number(xAxis._offset) + ((value - axisStart) / (axisEnd - axisStart)) * Number(xAxis._length);
    const start = project(range.start); const end = project(range.end);
    rangeOverlay.value = { left: Math.min(start, end), top: Number(yAxis._offset), width: Math.max(1, Math.abs(end - start)), height: Number(yAxis._length) };
    return;
  }
  const extent = dataExtent();
  if (!extent) { rangeOverlay.value = null; return; }
  const margin = { left: 58, right: 26, top: 48, bottom: 62 };
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
  if (!activeRangeDrag) return;
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
function finishRangeDrag(): void {
  if (!activeRangeDrag) return;
  const next = draggingRange.value;
  activeRangeDrag = null;
  window.removeEventListener("pointermove", updateRangeDrag);
  window.removeEventListener("pointerup", finishRangeDrag);
  if (isAnalysisRange(next)) {
    // Keep this light-weight overlay alive for the one render turn in which the
    // parent is applying the emitted range and Plotly is redrawing its shapes.
    pendingRange.value = { ...next };
    emit("range", next);
  }
  draggingRange.value = null;
  scheduleRangeOverlay();
}
function beginRangeDrag(kind: RangeDragKind, event: PointerEvent): void {
  const range = displayedRange.value;
  if (!isAnalysisRange(range)) return;
  event.preventDefault();
  selectionMode.value = false;
  rangeEditing.value = true;
  activeRangeDrag = { kind, initial: { ...range }, startClientX: event.clientX };
  draggingRange.value = { ...range };
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.setPointerCapture?.(event.pointerId);
  window.addEventListener("pointermove", updateRangeDrag);
  window.addEventListener("pointerup", finishRangeDrag, { once: true });
}
function stopActiveRangeDrag(): void {
  activeRangeDrag = null;
  draggingRange.value = null;
  window.removeEventListener("pointermove", updateRangeDrag);
  window.removeEventListener("pointerup", finishRangeDrag);
}
function endRangeEditing(): void {
  rangeEditing.value = false;
  stopActiveRangeDrag();
  scheduleRangeOverlay();
}
function toggleRangeEditing(): void {
  if (rangeEditing.value) {
    endRangeEditing();
    return;
  }
  selectionMode.value = false;
  rangeEditing.value = true;
  void nextTick(() => {
    draw();
    scheduleRangeOverlay();
  });
}
function toggleRangeSelection(): void {
  if (!selectionMode.value) rangeEditing.value = false;
  selectionMode.value = !selectionMode.value;
  nextTick(draw);
}
function leaveRangeSelection(): void {
  if (!selectionMode.value) return;
  selectionMode.value = false;
  nextTick(draw);
}
function restoreRangeControls(): void {
  leaveRangeSelection();
  rangeEditing.value = true;
  pendingRange.value = null;
  // Plotly may reset its axes after a double-click.  Run after Vue has removed
  // the selection layer, then schedule one more geometry pass for that reset.
  void nextTick(() => scheduleRangeOverlay());
}
function handleRangeEditorKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !rangeEditing.value) return;
  endRangeEditing();
}
function peakWidthReadout(result: FitResult): string | null {
  return overallWidthText(result,widthUnit.value||"X 单位");
}
const chartAnchors = computed(() => {
  const ordered = props.anchors
    .map((anchor, sourceIndex) => ({ anchor, sourceIndex }))
    .sort((left, right) => left.anchor.x - right.anchor.x || left.sourceIndex - right.sourceIndex)
    .map(({ anchor }) => anchor);
  const grouped = new Map<string, { x: number; y: number; numbers: number[] }>();
  ordered.forEach((anchor, index) => {
    const key = `${anchor.x}:${anchor.y}`;
    const group = grouped.get(key) ?? { x: anchor.x, y: anchor.y, numbers: [] };
    group.numbers.push(index + 1);
    grouped.set(key, group);
  });
  return [...grouped.values()].map((anchor) => ({ ...anchor, label: `#${anchor.numbers.join("/")}` }));
});
function nearestDataPoint(targetX: number): Anchor | null {
  let nearest: Anchor | null = null;
  let nearestDistance = Infinity;
  props.x.forEach((x, index) => {
    const y = props.y[index];
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
function draw(): void {
  if (!chart.value) return;
  if (!props.x.length) {
    Plotly.purge(chart.value);
    return;
  }
  const traces: object[] = [{ x: props.x, y: props.y, type: "scatter", mode: "markers", name: "原始数据点", marker: { color: "#94a8b5", size: 5, opacity: 0.55 } }];
  if (rangeEndpointPoints.value.length === 2) traces.push({
    x: rangeEndpointPoints.value.map((point) => point.x), y: rangeEndpointPoints.value.map((point) => point.y), type: "scatter", mode: "markers+text", name: "分析区间端点",
    text: rangeEndpointPoints.value.map((point) => point.label), textposition: ["top right", "top left"], textfont: { color: "#315f70", size: 11, family: "IBM Plex Sans, Microsoft YaHei, sans-serif" },
    customdata: rangeEndpointPoints.value.map((point) => point.endpoint), marker: { color: ["#087b79", "#236a9a"], size: 11, symbol: "circle", line: { color: "#fff", width: 2 } }, hovertemplate: "%{text}<br>Y = %{y:.6g}<extra></extra>", cliponaxis: false, showlegend: false,
  });
  if (chartAnchors.value.length) traces.push(
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "markers", name: "基线锚点", marker: { color: "#d97706", size: 11, symbol: "diamond", line: { color: "#fff", width: 1.5 } } },
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "text", text: chartAnchors.value.map((anchor) => anchor.label), textposition: "top center", textfont: { color: "#9a3412", size: 12, family: "IBM Plex Sans, Microsoft YaHei, sans-serif" }, hoverinfo: "skip", showlegend: false, cliponaxis: false },
  );
  if (props.baselinePreview && (!props.result || props.stale)) traces.push({ x: props.baselinePreview.x, y: props.baselinePreview.baseline, type: "scatter", mode: "lines", name: "待复核基线", line: { color: "#bc5a20", dash: "dot", width: 3 } });
  const rangeShapes: object[] = isAnalysisRange(props.analysisRange) ? [
    { type: "rect", xref: "x", x0: props.analysisRange.start, x1: props.analysisRange.end, yref: "paper", y0: 0, y1: 1, layer: "below", editable: false, line: { width: 0 }, fillcolor: "rgba(6, 109, 106, 0.10)" },
    { type: "line", xref: "x", x0: props.analysisRange.start, x1: props.analysisRange.start, yref: "paper", y0: 0, y1: 1, editable: false, line: { color: "#087b79", width: 2 } },
    { type: "line", xref: "x", x0: props.analysisRange.end, x1: props.analysisRange.end, yref: "paper", y0: 0, y1: 1, editable: false, line: { color: "#236a9a", width: 2 } },
  ] : [];
  const center = props.result?.parameters.xc?.value;
  const guideShapes: object[] = Number.isFinite(center) ? [{ type: "line", x0: center, x1: center, y0: 0, y1: 1, yref: "paper", editable: false, line: { color: "#4d6f86", width: 1.25, dash: "dot" } }] : [];
  const guideAnnotations: object[] = Number.isFinite(center) ? [{ x: center, y: 1, yref: "paper", text: `${props.stale ? "上次" : ""}峰中心 ${Number(center).toPrecision(6)}`, showarrow: false, yshift: 40, font: { size: 10, color: "#4d6f86" }, bgcolor: "rgba(255,255,255,.85)" }] : [];
  if (props.result) {
    const model = peakModelInfo(props.result.model);
    traces.push(
      { x: props.result.x, y: props.result.baseline, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合" : ""}基线`, line: { color: "#d97706", dash: "dash", width: 3 } },
      { x: props.result.x, y: props.result.total_y, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合 · " : ""}${model?.label ?? "峰模型"} 总拟合`, line: { color: "#006c67", width: 4.5, dash: "solid" } },
    );
  }
  const chartRender = Plotly.react(chart.value, traces, { height: 460, margin: { l: 58, r: 26, t: 48, b: 62 }, title: { text: chartTitle.value, x: 0.02, font: { size: 18, color: "#173242" } }, dragmode: selectionMode.value ? "select" : "pan", selectdirection: "h", xaxis: { title: { text: xAxisTitle.value }, gridcolor: "#e5ecee" }, yaxis: { title: { text: isXrd.value ? "衍射强度（原数据单位）" : "Y" }, gridcolor: "#e5ecee" }, shapes: [...rangeShapes, ...guideShapes], annotations: guideAnnotations, legend: { orientation: "h", y: -0.18 }, paper_bgcolor: "#fff", plot_bgcolor: "#fff" }, {
    ...PLOTLY_CHINESE_CONFIG,
    editable: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  });
  scheduleRangeOverlay();
  void Promise.resolve(chartRender).then(scheduleRangeOverlay);
  const node = chart.value as PlotlyChartNode;
  node.removeAllListeners?.("plotly_click");
  node.removeAllListeners?.("plotly_selected");
  node.removeAllListeners?.("plotly_relayout");
  node.removeAllListeners?.("plotly_doubleclick");
  node.removeAllListeners?.("plotly_deselect");
  node.on?.("plotly_click", (event) => {
    if (selectionMode.value) { leaveRangeSelection(); return; }
    const point = event.points[0];
    if (!point) return;
    if (point.data?.name === "分析区间端点" && (point.customdata === "start" || point.customdata === "end")) {
      emit("range-endpoint-focus", point.customdata);
      return;
    }
    emit("anchor", { x: point.x, y: point.y });
  });
  node.on?.("plotly_selected", (event) => {
    const selected = (event.points as Array<{ x: number }>).map((point: { x: number }) => point.x).filter((value: number) => Number.isFinite(value));
    if (selected.length >= 2) emit("range", { start: Math.min(...selected), end: Math.max(...selected) });
    leaveRangeSelection();
  });
  node.on?.("plotly_relayout", scheduleRangeOverlay);
  node.on?.("plotly_doubleclick", restoreRangeControls);
  node.on?.("plotly_deselect", leaveRangeSelection);
  if (residualChart.value && props.result) Plotly.react(residualChart.value, [{ x: props.result.x, y: props.result.residual, type: "scatter", mode: "markers", name: "Residual = 实测 − 拟合", marker: { color: "#567181", size: 4, opacity: 0.6 } }], { height: 190, margin: { l: 58, r: 26, t: 18, b: 48 }, dragmode: "pan", xaxis: { title: { text: xAxisTitle.value }, gridcolor: "#e5ecee" }, yaxis: { title: { text: "Residual = 实测 − 拟合" }, gridcolor: "#e5ecee", zeroline: true, zerolinewidth: 1.5, zerolinecolor: "#506b78" }, shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: "#506b78", width: 1.5 } }], showlegend: false, paper_bgcolor: "#fff", plot_bgcolor: "#fff" }, PLOTLY_CHINESE_CONFIG);
}
function downloadImage(): void {
  if (chart.value && props.x.length && !props.stale) Plotly.downloadImage(chart.value, { format: "png", filename: isXrd.value ? "xrd-peak-fit" : "single-peak-fit", width: 1600, height: 900, scale: 2 });
}
onMounted(() => {
  draw();
  window.addEventListener("resize", scheduleRangeOverlay);
  window.addEventListener("keydown", handleRangeEditorKeydown);
});
watch(() => props.analysisRange, (range) => {
  if (pendingRange.value && isAnalysisRange(range)) pendingRange.value = null;
}, { deep: true });
watch(() => [props.x, props.y, props.anchors, props.analysisRange, props.baselinePreview, props.result, props.stale, props.analysisMode] as const, () => nextTick(draw), { deep: true });
onBeforeUnmount(() => {
  activeRangeDrag = null;
  window.removeEventListener("pointermove", updateRangeDrag);
  window.removeEventListener("pointerup", finishRangeDrag);
  window.removeEventListener("resize", scheduleRangeOverlay);
  window.removeEventListener("keydown", handleRangeEditorKeydown);
  if (rangeOverlayFrame !== null) window.cancelAnimationFrame(rangeOverlayFrame);
  if (chart.value) Plotly.purge(chart.value); if (residualChart.value) Plotly.purge(residualChart.value);
});
defineExpose({ downloadImage });
</script>
<template>
  <section class="chart-stack">
    <div class="chart-heading">
      <div>
        <p class="section-kicker">分析画布</p>
        <h2>{{ chartTitle }}</h2>
        <p v-if="isXrd" class="hint">X 列应为 2θ（°），Y 列为衍射强度。选取一个衍射峰附近的区间进行拟合；模式切换不转换原始数据。</p>
        <p data-test="analysis-summary" class="analysis-summary">主图展示原始数据、分析范围、基线和总拟合，并以峰中心辅助对照。</p>
      </div>
      <span v-if="x.length" class="point-count">{{ x.length }} 个数据点</span>
    </div>

    <div v-if="x.length" class="analysis-range-toolbar">
      <div v-if="displayedRange" data-test="analysis-range-readout" class="analysis-range-readout" aria-live="polite">
        <strong>分析范围</strong>
        <span class="range-start">起点 {{ formatAxisValue(displayedRange.start) }}</span>
        <span class="range-arrow" aria-hidden="true">→</span>
        <span class="range-end">终点 {{ formatAxisValue(displayedRange.end) }}</span>
      </div>
      <span v-else class="analysis-range-readout pending">尚未选择有效分析范围</span>
      <span v-if="displayedRange" data-test="analysis-range-adjustment-hint" class="analysis-range-adjustment-hint">
        <template v-if="rangeEditing">正在调整：拖动左右边界，或拖动图上方箭头整体平移；完成后点击“完成调整”。</template>
        <template v-else>点击“调整范围”显示手柄；<span data-test="range-recovery-hint">手柄未显示时，双击主图恢复</span></template>
      </span>
      <button data-test="range-edit-toggle" class="range-edit-button" type="button" :aria-pressed="rangeEditing" @click="toggleRangeEditing">
        <span aria-hidden="true">↔</span>{{ rangeEditing ? "完成调整" : "调整范围" }}
      </button>
      <button data-test="range-selection-toggle" class="range-selection-button" type="button" :aria-pressed="selectionMode" @click="toggleRangeSelection">
        <span aria-hidden="true">⌗</span>{{ selectionMode ? "取消框选" : "框选分析区间" }}
      </button>
    </div>

    <div v-if="result && peakModelInfo(result.model)" class="chart-model-readout"><strong>{{ peakModelInfo(result.model)?.label }}</strong><span>{{ peakModelInfo(result.model)?.formula }}</span><span v-if="peakWidthReadout(result)">{{ peakWidthReadout(result) }}</span><span>拟合区间 {{ result.range_start }} — {{ result.range_end }}</span><em v-if="stale" class="stale-curve-badge">上一次拟合 · 待复核</em></div>
    <div class="chart-canvas">
      <div ref="chart" class="chart" @dblclick="restoreRangeControls"/>
      <div v-if="rangeOverlay && displayedRange && rangeEditing && !selectionMode" data-test="range-manipulator" class="range-manipulator" :style="rangeOverlayStyle" aria-label="分析范围直接调整">
        <div class="range-manipulator-tint" aria-hidden="true"/>
        <button data-test="range-start-handle" class="range-boundary-handle start" type="button" :aria-label="`拖动分析范围起点：${formatAxisValue(displayedRange.start)}`" title="拖动调整起点" @pointerdown.stop.prevent="beginRangeDrag('start', $event)">
          <span aria-hidden="true">↔</span>
        </button>
        <button data-test="range-window-handle" class="range-window-handle" type="button" aria-label="拖动分析范围整体平移" title="拖动整体平移分析范围" @pointerdown.stop.prevent="beginRangeDrag('move', $event)">
          <span aria-hidden="true">↔</span>
        </button>
        <button data-test="range-end-handle" class="range-boundary-handle end" type="button" :aria-label="`拖动分析范围终点：${formatAxisValue(displayedRange.end)}`" title="拖动调整终点" @pointerdown.stop.prevent="beginRangeDrag('end', $event)">
          <span aria-hidden="true">↔</span>
        </button>
      </div>
      <div v-if="selectionMode" data-test="range-selection-guide" class="range-selection-guide" role="status"><strong>框选分析区间</strong><span>在主图中水平拖拽，松开鼠标后自动更新起点和终点。</span></div>
      <div v-if="!x.length" class="chart-empty"><strong>导入曲线后开始分析</strong><span>选择 X/Y 数值列后，在此预览基线并执行拟合。</span></div>
    </div>
    <p v-if="x.length" class="hint chart-hint">图内空白处可平移，滚轮可缩放。默认不显示编辑手柄，避免遮住峰形；点击“调整范围”后，绿色和蓝色边界可微调，图上方箭头可整体平移。起点、终点圆点对应最近原始数据点，单击可定位左侧输入框；需要重选时，点击上方“框选分析区间”。</p>
    <section v-if="result" data-test="residual-diagnostic" class="residual-section"><div class="residual-heading"><div><p class="section-kicker">拟合质量</p><h3>残差诊断</h3></div><span>Residual = 实测值 − 拟合值；观察是否围绕零线随机散布。</span></div><div ref="residualChart" class="residual-chart"/></section>
  </section>
</template>
