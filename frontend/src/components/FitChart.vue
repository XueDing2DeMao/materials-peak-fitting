<script setup lang="ts">
import { figureAxis, figureLayout, FIGURE_COLORS, FIGURE_FONT } from "../figureStyle";
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
let sizeObserver: ResizeObserver | undefined;
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
  const height = chart.value.clientHeight || 360;
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
  const margin = { left: 76, right: 24, top: 68, bottom: 52 };
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
  const traces: object[] = [{ x: props.x, y: props.y, type: "scatter", mode: "markers", name: "原始数据点", marker: { color: FIGURE_COLORS.observation, size: 4, opacity: 0.7 } }];
  if (rangeEndpointPoints.value.length === 2) traces.push({
    x: rangeEndpointPoints.value.map((point) => point.x), y: rangeEndpointPoints.value.map((point) => point.y), type: "scatter", mode: "markers", name: "分析区间端点",
    text: rangeEndpointPoints.value.map((point) => point.label), textposition: ["top right", "top left"], textfont: { color: "#315f70", size: 11, family: FIGURE_FONT },
    customdata: rangeEndpointPoints.value.map((point) => point.endpoint), marker: { color: ["#087b79", "#236a9a"], size: 11, symbol: "circle", line: { color: "#fff", width: 2 } }, hovertemplate: "%{text}<br>Y = %{y:.6g}<extra></extra>", cliponaxis: false, showlegend: false,
  });
  if (chartAnchors.value.length) traces.push(
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "markers", name: "基线锚点", marker: { color: "#d97706", size: 11, symbol: "diamond", line: { color: "#fff", width: 1.5 } } },
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "text", text: chartAnchors.value.map((anchor) => anchor.label), textposition: "top center", textfont: { color: "#9a3412", size: 12, family: FIGURE_FONT }, hoverinfo: "skip", showlegend: false, cliponaxis: false },
  );
  if (props.baselinePreview && (!props.result || props.stale)) traces.push({ x: props.baselinePreview.x, y: props.baselinePreview.baseline, type: "scatter", mode: "lines", name: "待复核基线", line: { color: FIGURE_COLORS.background, dash: "dot", width: 1.5 } });
  const rangeShapes: object[] = isAnalysisRange(props.analysisRange) ? [
    { type: "rect", xref: "x", x0: props.analysisRange.start, x1: props.analysisRange.end, yref: "paper", y0: 0, y1: 1, layer: "below", editable: false, line: { width: 0 }, fillcolor: "rgba(80, 80, 80, 0.035)" },
    { type: "line", xref: "x", x0: props.analysisRange.start, x1: props.analysisRange.start, yref: "paper", y0: 0, y1: 1, editable: false, line: { color: "#087b79", width: 1, dash: "dot" } },
    { type: "line", xref: "x", x0: props.analysisRange.end, x1: props.analysisRange.end, yref: "paper", y0: 0, y1: 1, editable: false, line: { color: "#236a9a", width: 1, dash: "dot" } },
  ] : [];
  const center = props.result?.parameters.xc?.value;
  const guideShapes: object[] = Number.isFinite(center) ? [{ type: "line", x0: center, x1: center, y0: 0, y1: 1, yref: "paper", editable: false, line: { color: FIGURE_COLORS.reference, width: 1, dash: "dot" } }] : [];
  const guideAnnotations: object[] = Number.isFinite(center) ? [{ x: center, y: 1, yref: "paper", text: `${props.stale ? "上次" : ""}峰中心 ${Number(center).toPrecision(6)}`, showarrow: false, yshift: 8, font: { family: FIGURE_FONT, size: 12, color: FIGURE_COLORS.ink }, bgcolor: "rgba(255,255,255,.85)" }] : [];
  if (props.result) {
    const model = peakModelInfo(props.result.model);
    traces.push(
      { x: props.result.x, y: props.result.baseline, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合" : ""}基线`, line: { color: FIGURE_COLORS.background, dash: "dash", width: 1.5 } },
      { x: props.result.x, y: props.result.total_y, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合 · " : ""}${model?.label ?? "峰模型"} 总拟合`, line: { color: FIGURE_COLORS.fit, width: 2.2, dash: "solid" } },
    );
  }
  const chartRender = Plotly.react(chart.value, traces, { ...figureLayout(), height: chart.value.clientHeight || 360, margin: { l: 76, r: 24, t: 68, b: 52 }, dragmode: selectionMode.value ? "select" : "pan", selectdirection: "h", xaxis: figureAxis(xAxisTitle.value), yaxis: figureAxis(isXrd.value ? "衍射强度（原数据单位）" : "Y"), shapes: [...rangeShapes, ...guideShapes], annotations: guideAnnotations }, {
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
  if (residualChart.value && props.result) Plotly.react(residualChart.value,
    [{ x: props.result.x, y: props.result.residual, type: "scatter", mode: "markers", name: "残差 = 实测 − 拟合", marker: { color: FIGURE_COLORS.residual, size: 4, opacity: 0.8 } }],
    { ...figureLayout(), height: residualChart.value.clientHeight || 160, margin: { l: 76, r: 24, t: 16, b: 52 }, dragmode: "pan",
      xaxis: figureAxis(xAxisTitle.value), yaxis: { ...figureAxis("残差"), nticks: 3 },
      shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, layer: "below", line: { color: FIGURE_COLORS.reference, width: 1, dash: "dash" } }], showlegend: false }, PLOTLY_CHINESE_CONFIG);
}
function downloadImage(): void {
  if (chart.value && props.x.length && !props.stale) Plotly.downloadImage(chart.value, { format: "png", filename: isXrd.value ? "xrd-peak-fit" : "single-peak-fit", width: 1600, height: 900, scale: 2 });
}
onMounted(() => {
  draw();
  if (typeof ResizeObserver !== "undefined" && chart.value) {
    let previousWidth = 0;
    sizeObserver = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0 && width !== previousWidth) { previousWidth = width; void nextTick(draw); }
    });
    sizeObserver.observe(chart.value);
  }
  window.addEventListener("resize", scheduleRangeOverlay);
  window.addEventListener("keydown", handleRangeEditorKeydown);
});
watch(() => props.analysisRange, (range) => {
  if (pendingRange.value && isAnalysisRange(range)) pendingRange.value = null;
}, { deep: true });
watch(() => [props.x, props.y, props.anchors, props.analysisRange, props.baselinePreview, props.result, props.stale, props.analysisMode] as const, () => nextTick(draw), { deep: true });
onBeforeUnmount(() => {
  sizeObserver?.disconnect();
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
        <h2>分析画布</h2>
      </div>
      <span v-if="x.length" class="point-count">{{ x.length }} 个数据点</span>
    </div>

    <div v-if="x.length" class="analysis-range-toolbar">
      <div v-if="displayedRange" data-test="analysis-range-readout" class="analysis-range-readout" aria-live="polite">
        <strong>分析区间</strong>
        <span class="range-start">起点 {{ formatAxisValue(displayedRange.start) }}</span>
        <span class="range-arrow" aria-hidden="true">→</span>
        <span class="range-end">终点 {{ formatAxisValue(displayedRange.end) }}</span>
      </div>
      <span v-else class="analysis-range-readout pending">请选择有效分析区间</span>
      <span v-if="displayedRange && rangeEditing" data-test="analysis-range-adjustment-hint" class="analysis-range-adjustment-hint">
        拖动边界调整区间，拖动上方箭头整体平移。
      </span>
      <button data-test="range-edit-toggle" class="range-edit-button" type="button" :aria-pressed="rangeEditing" @click="toggleRangeEditing">
        <span aria-hidden="true">↔</span>{{ rangeEditing ? "完成调整" : "调整范围" }}
      </button>
      <button data-test="range-selection-toggle" class="range-selection-button" type="button" :aria-pressed="selectionMode" @click="toggleRangeSelection">
        <span aria-hidden="true">⌗</span>{{ selectionMode ? "取消框选" : "框选分析区间" }}
      </button>
    </div>

    <div v-if="result && peakModelInfo(result.model)" class="chart-model-readout"><span v-if="peakWidthReadout(result)">{{ peakWidthReadout(result) }}</span><span>拟合区间 {{ result.range_start }} — {{ result.range_end }}</span><em v-if="stale" class="stale-curve-badge">上一次拟合 · 已过期</em></div>
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
      <div v-if="selectionMode" data-test="range-selection-guide" class="range-selection-guide" role="status"><strong>框选分析区间</strong><span>水平拖动，松开后更新区间。</span></div>
      <div v-if="!x.length" class="chart-empty"><strong>请导入数据并选择 X/Y 列</strong></div>
    </div>
    <section v-if="result" data-test="residual-diagnostic" class="residual-section"><div class="residual-heading"><h3>残差诊断</h3><span>实测值 − 拟合值；观察是否围绕零线随机散布。</span></div><div ref="residualChart" class="residual-chart"/></section>
    <details v-if="x.length || isXrd" class="chart-help"><summary>操作说明</summary>
      <p v-if="isXrd" class="hint">X 为 2θ（°），Y 为衍射强度；切换工作流不转换数据。</p>
      <p v-if="x.length" class="hint">拖动空白处平移，滚轮缩放。点击“调整范围”显示手柄，双击主图可恢复手柄。点击区间端点定位输入框。</p>
    </details>
  </section>
</template>
