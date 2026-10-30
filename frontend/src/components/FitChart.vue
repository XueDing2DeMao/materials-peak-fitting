<script setup lang="ts">
import { useAnalysisRange, analysisRangeShapes, rangeEndpointTrace } from '../useAnalysisRange';
import AnalysisRangeToolbar from './AnalysisRangeToolbar.vue';
import AnalysisRangeOverlay from './AnalysisRangeOverlay.vue';
import { figureAxis, figureLayout, FIGURE_COLORS, FIGURE_FONT, FIGURE_TEXT } from "../figureStyle";
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
let sizeObserver: ResizeObserver | undefined;
const {selectionMode,rangeEditing,displayedRange,rangeOverlay,reversed,startVisible,endVisible,rangeEndpointPoints,scheduleRangeOverlay,
  beginRangeDrag,toggleRangeEditing,toggleRangeSelection,leaveRangeSelection,restoreRangeControls,selectRange} = useAnalysisRange({
  chart,x:()=>props.x,y:()=>props.y,range:()=>props.analysisRange,change:range=>emit('range',range),redraw:draw,
});
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
function draw(): void {
  if (!chart.value) return;
  if (!props.x.length) {
    Plotly.purge(chart.value);
    return;
  }
  const traces: object[] = [{ x: props.x, y: props.y, type: "scatter", mode: "markers", name: "原始数据点", marker: { color: FIGURE_COLORS.observation, size: 4, opacity: 0.7 } }];
  if (rangeEndpointPoints.value.length === 2) traces.push(rangeEndpointTrace(rangeEndpointPoints.value));
  if (chartAnchors.value.length) traces.push(
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "markers", name: "基线锚点", marker: { color: "#d97706", size: 11, symbol: "diamond", line: { color: "#fff", width: 1.5 } } },
    { x: chartAnchors.value.map((anchor) => anchor.x), y: chartAnchors.value.map((anchor) => anchor.y), type: "scatter", mode: "text", text: chartAnchors.value.map((anchor) => anchor.label), textposition: "top center", textfont: { color: "#9a3412", size: FIGURE_TEXT.annotation, family: FIGURE_FONT }, hoverinfo: "skip", showlegend: false, cliponaxis: false },
  );
  if (props.baselinePreview && (!props.result || props.stale)) traces.push({ x: props.baselinePreview.x, y: props.baselinePreview.baseline, type: "scatter", mode: "lines", name: "待复核基线", line: { color: FIGURE_COLORS.background, dash: "dot", width: 1.5 } });
  const rangeShapes = analysisRangeShapes(props.analysisRange);
  const center = props.result?.parameters.xc?.value;
  const guideShapes: object[] = Number.isFinite(center) ? [{ type: "line", x0: center, x1: center, y0: 0, y1: 1, yref: "paper", editable: false, line: { color: FIGURE_COLORS.reference, width: 1, dash: "dot" } }] : [];
  const guideAnnotations: object[] = Number.isFinite(center) ? [{ x: center, y: 1, yref: "paper", text: `${props.stale ? "上次" : ""}峰中心 ${Number(center).toPrecision(6)}`, showarrow: false, yshift: 8, font: { family: FIGURE_FONT, size: FIGURE_TEXT.annotation, color: FIGURE_COLORS.ink }, bgcolor: "rgba(255,255,255,.85)" }] : [];
  if (props.result) {
    const model = peakModelInfo(props.result.model);
    traces.push(
      { x: props.result.x, y: props.result.baseline, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合" : ""}基线`, line: { color: FIGURE_COLORS.background, dash: "dash", width: 1.5 } },
      { x: props.result.x, y: props.result.total_y, type: "scatter", mode: "lines", name: `${props.stale ? "上次拟合 · " : ""}${model?.label ?? "峰模型"} 总拟合`, line: { color: FIGURE_COLORS.fit, width: 2.2, dash: "solid" } },
    );
  }
  const chartRender = Plotly.react(chart.value, traces, { ...figureLayout(chart.value.clientWidth), height: chart.value.clientHeight || 360, margin: { autoexpand: false, l: 84, r: 24, t: chart.value.clientWidth < 400 ? 120 : 80, b: 60 }, dragmode: selectionMode.value ? "select" : "pan", selectdirection: "h", selections: [], selectionrevision: String(selectionMode.value), xaxis: { ...figureAxis(xAxisTitle.value), nticks: chart.value.clientWidth < 400 ? 3 : 5 }, yaxis: figureAxis(isXrd.value ? "衍射强度（原数据单位）" : "Y"), shapes: [...rangeShapes, ...guideShapes], annotations: guideAnnotations }, {
    ...PLOTLY_CHINESE_CONFIG,
    editable: false,
    modeBarButtonsToRemove: ["select2d", "lasso2d"],
  });
  scheduleRangeOverlay();
  void Promise.resolve(chartRender).then(scheduleRangeOverlay);
  const node = chart.value as HTMLDivElement & {on?:(name:string,fn:(event:any)=>void)=>void;removeAllListeners?:(name:string)=>void};
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
  node.on?.("plotly_selected", selectRange);
  node.on?.("plotly_relayout", scheduleRangeOverlay);
  node.on?.("plotly_doubleclick", restoreRangeControls);
  node.on?.("plotly_deselect", leaveRangeSelection);
  if (residualChart.value && props.result) Plotly.react(residualChart.value,
    [{ x: props.result.x, y: props.result.residual, type: "scatter", mode: "lines+markers", name: "残差 = 实测 − 拟合", line: { color: FIGURE_COLORS.residual, width: 1, shape: "linear" }, marker: { color: FIGURE_COLORS.residual, size: 4, opacity: 0.8 }, connectgaps: false }],
    { ...figureLayout(), height: residualChart.value.clientHeight || 180, margin: { autoexpand: false, l: 84, r: 24, t: 16, b: 60 }, dragmode: "pan",
      xaxis: { ...figureAxis(xAxisTitle.value), nticks: chart.value.clientWidth < 400 ? 3 : 5 }, yaxis: { ...figureAxis("残差"), nticks: 3 },
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

});
watch(() => [props.x, props.y, props.anchors, props.analysisRange, props.baselinePreview, props.result, props.stale, props.analysisMode] as const, () => nextTick(draw), { deep: true });
onBeforeUnmount(() => {
  sizeObserver?.disconnect();
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

    <AnalysisRangeToolbar v-if="x.length" :range="displayedRange" :range-editing="rangeEditing" :selection-mode="selectionMode" @edit="toggleRangeEditing" @select="toggleRangeSelection" />
    <div v-if="result && peakModelInfo(result.model)" class="chart-model-readout"><span v-if="peakWidthReadout(result)">{{ peakWidthReadout(result) }}</span><span>拟合区间 {{ result.range_start }} — {{ result.range_end }}</span><em v-if="stale" class="stale-curve-badge">上一次拟合 · 已过期</em></div>
    <p v-if="selectionMode" data-test="range-selection-guide" class="range-selection-guide" role="status">框选分析区间：水平拖动，松开后更新区间。</p>
    <div class="chart-canvas">
      <div ref="chart" class="chart" @dblclick="restoreRangeControls"/>
      <AnalysisRangeOverlay :geometry="rangeOverlay" :range="displayedRange" :range-editing="rangeEditing" :selection-mode="selectionMode" :reversed="reversed" :start-visible="startVisible" :end-visible="endVisible" @drag="beginRangeDrag" />
      <div v-if="!x.length" class="chart-empty"><strong>请导入数据并选择 X/Y 列</strong></div>
    </div>
    <section v-if="result" data-test="residual-diagnostic" class="residual-section" aria-label="残差诊断"><div ref="residualChart" class="residual-chart"/></section>
    <details v-if="x.length || isXrd" class="chart-help"><summary>操作说明</summary>
      <p v-if="isXrd" class="hint">X 为 2θ（°），Y 为衍射强度；切换工作流不转换数据。</p>
      <p v-if="x.length" class="hint">拖动空白处平移，滚轮滚动页面。使用图表工具栏的“框选缩放”“放大”“缩小”调整视图，“重置坐标轴”恢复视图。点击“调整范围”显示手柄，双击主图可恢复手柄。点击区间端点定位输入框。</p>
    </details>
  </section>
</template>
