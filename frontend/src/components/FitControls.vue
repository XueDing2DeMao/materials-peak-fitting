<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { MODEL_GROUPS, PEAK_MODEL_PARAMETERS, PARAMETER_LABELS, type PeakParameterName, peakModelInfo } from "../peakModels";
import type { Anchor, AutoPeakAnalysis, BaselineKind, FitRequest, PeakModel } from "../types";

const props = withDefaults(defineProps<{ x: number[]; y: number[]; fitting?: boolean; dataLoading?: boolean; baselinePreviewed?: boolean; autoAnalysis?: AutoPeakAnalysis | null; analysisMode?: "single" | "xrd" }>(), { baselinePreviewed: false, autoAnalysis: null, analysisMode: "single" });
const emit = defineEmits<{
  fit: [request: FitRequest];
  "preview-baseline": [request: FitRequest];
  "anchors-change": [anchors: Anchor[]];
  "settings-change": [];
  "baseline-change": [];
  "auto-analyze": [request: FitRequest];
  "range-change": [range: { start: number; end: number } | null];
}>();

const model = ref<PeakModel>("gaussian");
const baselineKind = ref<BaselineKind>("line");
const anchors = ref<Anchor[]>([]);
interface OrderedAnchor { anchor: Anchor; sourceIndex: number; number: number; duplicateOf?: number }
const orderedAnchors = computed<OrderedAnchor[]>(() => {
  const ordered = anchors.value
    .map((anchor, sourceIndex) => ({ anchor, sourceIndex }))
    .sort((left, right) => left.anchor.x - right.anchor.x || left.sourceIndex - right.sourceIndex);
  const firstNumberByX = new Map<number, number>();
  return ordered.map((entry, index) => {
    const number = index + 1;
    const duplicateOf = firstNumberByX.get(entry.anchor.x);
    if (duplicateOf === undefined) firstNumberByX.set(entry.anchor.x, number);
    return { ...entry, number, duplicateOf };
  });
});
const usableAnchorCount = computed(() => new Set(anchors.value.map((anchor) => anchor.x)).size);
const anchorSource = ref<"manual" | "suggested" | "endpoint_default">("endpoint_default");
const baselineConfirmed = ref(true);
const degree = ref(2);
const smoothing = ref(0);
const rangeStart = ref(0);
const rangeEnd = ref(1);
const rangeStartInput = ref<HTMLInputElement | null>(null);
const rangeEndInput = ref<HTMLInputElement | null>(null);
const activeControlTab = ref<"baseline" | "peak" | "fit">("baseline");
const controlTabs = [{ id: "baseline", label: "区间与基线" }, { id: "peak", label: "峰模型" }, { id: "fit", label: "求解设置" }] as const;
function navigateTabs(event: KeyboardEvent): void {
  const current = controlTabs.findIndex(tab => tab.id === activeControlTab.value);
  const next = event.key === "Home" ? 0 : event.key === "End" ? 2 : event.key === "ArrowRight" ? (current + 1) % 3 : event.key === "ArrowLeft" ? (current + 2) % 3 : null;
  if (next === null) return;
  event.preventDefault();
  activeControlTab.value = controlTabs[next].id;
  const tablist = event.currentTarget as HTMLElement;
  void nextTick(() => tablist.querySelector<HTMLButtonElement>(`#control-tab-${activeControlTab.value}`)?.focus());
}
const parameterDialog = ref<HTMLDialogElement | null>(null);
const parameterEditorButton = ref<HTMLButtonElement | null>(null);
const parameterDialogOpen = ref(false);
function openParameterEditor(): void {
  parameterDialog.value?.showModal();
  parameterDialogOpen.value = true;
}
function closeParameterEditor(): void { parameterDialog.value?.close(); }
function onParameterEditorClosed(): void {
  parameterDialogOpen.value = false;
  parameterEditorButton.value?.focus();
}
function parameterSummary(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(6) : "—";
}
const stagedFit = ref(true);
const centerLockEvaluations = ref(20);
const maxFunctionEvaluations = ref(2000);
const tolerance = ref(1e-8);
type ParameterName = PeakParameterName;
interface ParameterDraft { initial: number; lower: string; upper: string; fixed: boolean }
const parameterDrafts = ref<Record<ParameterName, ParameterDraft>>({
  A: { initial: 1, lower: "", upper: "", fixed: false }, xc: { initial: 0, lower: "", upper: "", fixed: false },
  w: { initial: 1, lower: "", upper: "", fixed: false }, wG: { initial: 1, lower: "", upper: "", fixed: false },
  h_low: { initial: .5, lower: "", upper: "", fixed: false }, h_high: { initial: .5, lower: "", upper: "", fixed: false },
  sigma: { initial: .4, lower: "", upper: "", fixed: false }, tau: { initial: .1, lower: "", upper: "", fixed: false },
  wL: { initial: 1, lower: "", upper: "", fixed: false }, mu: { initial: 0.5, lower: "", upper: "", fixed: false },
});

const parameterNames = computed(() => PEAK_MODEL_PARAMETERS[model.value]);
const activeModel = computed(() => peakModelInfo(model.value)!);
const parameterLabel = computed(() => Object.fromEntries(Object.entries(PARAMETER_LABELS).map(([key,label]) => [key,label+(props.analysisMode === 'xrd'&&key!=='mu'?(key==='A'?'（强度 × °）':'（°）'):'')])) as Record<ParameterName,string>);

function resetRange(): void {
  if (props.x.length) {
    rangeStart.value = Math.min(...props.x);
    rangeEnd.value = Math.max(...props.x);
    const span = Math.max(rangeEnd.value - rangeStart.value, Number.EPSILON);
    const maximumIndex = props.y.indexOf(Math.max(...props.y));
    const amplitude = Math.max(...props.y) - Math.min(...props.y);
    const defaults: Record<ParameterName, number> = {
      A: Math.max(span * Math.max(amplitude, Number.EPSILON), Number.EPSILON),
      h_low: span/10, h_high: span/10, sigma: span/5/2.354820045, tau: span/5/2.354820045*.25,
      xc: props.x[maximumIndex] ?? 0, w: span / 5, wG: span / 5, wL: span / 5, mu: 0.5,
    };
    for (const name of Object.keys(defaults) as ParameterName[]) parameterDrafts.value[name].initial = defaults[name];
    emitRangeChange();
  }
}
watch(() => props.x, resetRange, { immediate: true });
watch(anchors, () => emit("anchors-change", orderedAnchors.value.map(({ anchor }) => ({ ...anchor }))), { deep: true });

const requiredAnchors = computed(() => {
  if (baselineKind.value === "none") return 0;
  if (baselineKind.value === "constant") return 1;
  if (baselineKind.value === "line") return 2;
  if (baselineKind.value === "polynomial") return degree.value + 1;
  if (baselineKind.value === "spline") return 3;
  return 4;
});
const recommendedAnchorCount = computed(() => {
  if (baselineKind.value === "none") return 0;
  if (baselineKind.value === "constant") return 1;
  if (baselineKind.value === "line") return 2;
  if (baselineKind.value === "polynomial") return degree.value + 2;
  if (baselineKind.value === "spline") return 4;
  return 6;
});
const enoughAnchors = computed(() => {
  if (baselineKind.value === "none") return true;
  if (baselineKind.value === "line" || baselineKind.value === "constant") return anchors.value.length === 0 || usableAnchorCount.value >= requiredAnchors.value;
  return usableAnchorCount.value >= requiredAnchors.value;
});
const baselineIsApproved = computed(() => anchorSource.value !== "suggested" || baselineConfirmed.value);
const selectedPointCount = computed(() => props.x.filter((value) => value >= rangeStart.value && value <= rangeEnd.value).length);
const minimumPointCount = computed(() => Math.max(4, ["none", "line", "constant"].includes(baselineKind.value) ? 0 : requiredAnchors.value));
const canPreviewBaseline = computed(() => selectedPointCount.value >= minimumPointCount.value && rangeEnd.value > rangeStart.value && enoughAnchors.value && baselineIsApproved.value);
const canFit = computed(() => canPreviewBaseline.value && !props.fitting && !props.dataLoading);
const missingAnchors = computed(() => Math.max(0, requiredAnchors.value - usableAnchorCount.value));
const anchorProgress = computed(() => {
  if (baselineKind.value === "none") return "不扣除基线：峰函数将直接拟合原始数据。";
  if ((baselineKind.value === "line" || baselineKind.value === "constant") && anchors.value.length === 0) return `自动估计${baselineKind.value === "line" ? "两端直线背景" : "背景常数"}。`;
  const count = anchors.value.length === usableAnchorCount.value ? `${usableAnchorCount.value}` : `${usableAnchorCount.value} 个有效（共 ${anchors.value.length} 个）`;
  if (missingAnchors.value) return `已设置 ${count} / ${requiredAnchors.value} 个，还差 ${missingAnchors.value} 个。`;
  if (!baselineIsApproved.value) return `已设置 ${count} / ${requiredAnchors.value} 个。辅助建议，未验证。`;
  return `已设置 ${count} / ${requiredAnchors.value} 个，可以拟合。`;
});
const fitBlockedMessage = computed(() => {
  if (props.fitting) return "正在拟合；修改设置后可重新提交，旧响应将被丢弃。";
  if (props.dataLoading) return "正在读取数据，请稍候。";
  if (props.x.length < 4) return "请先导入并选择至少 4 个有效数据点。";
  if (rangeEnd.value <= rangeStart.value) return "拟合终点必须大于起点。";
  if (selectedPointCount.value < minimumPointCount.value) return `当前拟合区间只有 ${selectedPointCount.value} 个点；${baselineKind.value === "line" ? "至少需要 4 个" : `当前基线至少需要 ${minimumPointCount.value} 个`}。`;
  if (!enoughAnchors.value) return `${activeModel.value.label} 配合 ${baselineKind.value === "bspline" ? "B-Spline" : "当前"} 基线还差 ${missingAnchors.value} 个锚点。可点击“生成建议锚点”。`;
  if (!baselineIsApproved.value) return "当前锚点来自自动建议；请先复核基线并勾选“我已复核建议锚点”。";
  return "";
});

function suggestedAnchors(count: number): Anchor[] {
  const points = props.x.map((x, index) => ({ x, y: props.y[index] ?? 0 }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y) && point.x >= rangeStart.value && point.x <= rangeEnd.value)
    .sort((left, right) => left.x - right.x);
  const requestedCount = Math.min(count, points.length);
  if (!points.length || requestedCount <= 0) return [];
  const window = Math.max(1, Math.ceil(points.length * 0.05));
  const median = (values: number[]): number => {
    const ordered = [...values].sort((left, right) => left - right);
    return ordered[Math.floor(ordered.length / 2)] ?? 0;
  };
  const endpointAnchors = [
    { x: points[0].x, y: median(points.slice(0, window).map((point) => point.y)) },
    { x: points.at(-1)!.x, y: median(points.slice(-window).map((point) => point.y)) },
  ];
  if (requestedCount <= 2) return endpointAnchors.slice(0, requestedCount);
  const peakIndex = points.reduce((best, point, index) => point.y > points[best].y ? index : best, 0);
  const exclusion = Math.max(1, Math.ceil(points.length * 0.1));
  const background = points.filter((_, index) => index > 0 && index < points.length - 1 && Math.abs(index - peakIndex) > exclusion);
  const interiorCount = requestedCount - 2;
  const interior = Array.from({ length: interiorCount }, (_, index) => {
    const target = Math.round((index + 1) * (background.length - 1) / (interiorCount + 1));
    const radius = Math.max(1, Math.ceil(background.length / Math.max(24, interiorCount * 8)));
    const candidates = background.slice(Math.max(0, target - radius), target + radius + 1);
    const targetPoint = background[target] ?? candidates[0] ?? points[peakIndex];
    const targetY = median(candidates.map((point) => point.y));
    return candidates.reduce((best, point) => {
      const bestDistance = Math.abs(best.y - targetY);
      const pointDistance = Math.abs(point.y - targetY);
      if (pointDistance !== bestDistance) return pointDistance < bestDistance ? point : best;
      return Math.abs(point.x - targetPoint.x) < Math.abs(best.x - targetPoint.x) ? point : best;
    }, candidates[0] ?? points[peakIndex]);
  });
  return [...endpointAnchors, ...interior].sort((left, right) => left.x - right.x);
}

function addAnchor(point?: Anchor): void {
  const suggestions = suggestedAnchors(Math.max(requiredAnchors.value, anchors.value.length + 1));
  const fallback = suggestions[Math.min(anchors.value.length, suggestions.length - 1)] ?? { x: rangeStart.value, y: props.y[0] ?? 0 };
  anchors.value.push(point ?? fallback);
  anchorSource.value = "manual";
  baselineConfirmed.value = true;
  notifyBaselineChange();
}
function generateSuggestedAnchors(): void {
  anchors.value = suggestedAnchors(recommendedAnchorCount.value);
  anchorSource.value = "suggested";
  baselineConfirmed.value = false;
  notifyBaselineChange();
}
function removeAnchor(sourceIndex: number): void {
  anchors.value.splice(sourceIndex, 1);
  anchorSource.value = "manual";
  baselineConfirmed.value = true;
  notifyBaselineChange();
}
function clearAnchors(): void {
  anchors.value = [];
  anchorSource.value = "manual";
  baselineConfirmed.value = true;
  notifyBaselineChange();
}
function markAnchorsAsManual(): void {
  anchorSource.value = "manual";
  baselineConfirmed.value = true;
  notifyBaselineChange();
}
function confirmSuggestedAnchors(): void { notifyBaselineChange(); }
function updateModel(next: PeakModel): void {
  if (model.value === next) return;
  model.value = next;
  emit("settings-change");
}
function notifySettingsChange(): void { emit("settings-change"); }
function notifyBaselineChange(): void { emit("settings-change"); emit("baseline-change"); }
function emitRangeChange(): void {
  if (Number.isFinite(rangeStart.value) && Number.isFinite(rangeEnd.value) && rangeEnd.value > rangeStart.value) {
    emit("range-change", { start: rangeStart.value, end: rangeEnd.value });
  } else {
    emit("range-change", null);
  }
}
function updateAnalysisRange(): void { notifyBaselineChange(); emitRangeChange(); }
function optionalNumber(value: string | number): number | undefined {
  const normalized = String(value).trim();
  const parsed = Number(normalized);
  return normalized && Number.isFinite(parsed) ? parsed : undefined;
}
function buildFitRequest(): FitRequest {
  const initial_parameters: Record<string, number> = {};
  const parameter_bounds: Record<string, { lower?: number; upper?: number }> = {};
  const fixed_parameters: Record<string, number> = {};
  for (const name of parameterNames.value) {
    const draft = parameterDrafts.value[name];
    initial_parameters[name] = draft.initial;
    const lower = optionalNumber(draft.lower); const upper = optionalNumber(draft.upper);
    if (lower !== undefined || upper !== undefined) parameter_bounds[name] = { lower, upper };
    if (draft.fixed) fixed_parameters[name] = draft.initial;
  }
  return {
    x: props.x, y: props.y, model: model.value, baseline_kind: baselineKind.value,
    anchors: orderedAnchors.value.map(({ anchor }) => ({ ...anchor })), degree: degree.value, smoothing: smoothing.value,
    range_start: rangeStart.value, range_end: rangeEnd.value, initial_parameters, parameter_bounds, fixed_parameters,
    anchor_source: anchorSource.value, baseline_confirmed: baselineConfirmed.value,
    staged_fit: stagedFit.value, center_lock_evaluations: centerLockEvaluations.value,
    max_function_evaluations: maxFunctionEvaluations.value, tolerance: tolerance.value,
  };
}
function previewBaseline(): void { if (canPreviewBaseline.value) emit("preview-baseline", buildFitRequest()); }
function runFit(): void { if (canFit.value) emit("fit", buildFitRequest()); }
function requestAutoAnalysis(): void { if (canPreviewBaseline.value) emit("auto-analyze", buildFitRequest()); }
function setAnalysisRange(range: { start: number; end: number }): void {
  if (!Number.isFinite(range.start) || !Number.isFinite(range.end) || range.end <= range.start) return;
  rangeStart.value = range.start;
  rangeEnd.value = range.end;
  updateAnalysisRange();
}
function focusRangeEndpoint(endpoint: "start" | "end"): void {
  activeControlTab.value = "baseline";
  void nextTick(() => {
    const input = endpoint === "start" ? rangeStartInput.value : rangeEndInput.value;
    input?.focus();
    input?.select();
  });
}
function adoptAutoInitialValues(): void {
  if (!props.autoAnalysis || props.autoAnalysis.model !== model.value) return;
  for (const name of parameterNames.value) {
    const value = props.autoAnalysis.initial_parameters[name];
    if (value !== undefined) parameterDrafts.value[name].initial = value;
  }
  notifySettingsChange();
}
watch(() => props.autoAnalysis, (analysis) => {
  if (analysis && analysis.model === model.value) adoptAutoInitialValues();
});
defineExpose({ addAnchor, buildFitRequest, setAnalysisRange, focusRangeEndpoint });
</script>

<template>
  <section class="panel controls-panel">
    <div class="controls-heading"><h2>拟合设置</h2><span class="hint">{{ x.length ? `${selectedPointCount} 个区间点` : '待导入数据' }}</span></div>
    <div class="control-tabs" role="tablist" aria-label="拟合设置页签" @keydown="navigateTabs">
      <button v-for="tab in controlTabs" :key="tab.id" :id="`control-tab-${tab.id}`" :data-test="`control-tab-${tab.id}`" type="button" role="tab" :aria-selected="activeControlTab === tab.id" :aria-controls="`control-pane-${tab.id}`" :tabindex="activeControlTab === tab.id ? 0 : -1" :class="{ active: activeControlTab === tab.id }" @click="activeControlTab = tab.id">{{ tab.label }}</button>
    </div>
    <div class="control-scroll">
      <section v-show="activeControlTab === 'baseline'" id="control-pane-baseline" aria-labelledby="control-tab-baseline" class="control-pane" role="tabpanel">
        <fieldset class="control-group"><legend>分析区间{{ analysisMode === 'xrd' ? ' / 2θ（°）' : '' }}</legend>
          <div v-show="x.length" class="field-grid">
            <label>起点<input ref="rangeStartInput" v-model.number="rangeStart" data-test="range-start" type="number" step="any" @input="updateAnalysisRange" /></label>
            <label>终点<input ref="rangeEndInput" v-model.number="rangeEnd" data-test="range-end" type="number" step="any" @input="updateAnalysisRange" /></label>
          </div>
          <p v-if="!x.length" class="hint control-empty">导入数据后，可设置区间或在主图框选。</p>
          <details v-else class="inline-help"><summary>如何选取区间</summary><p class="hint">覆盖目标峰并保留两端背景。主图框选可同步更新区间；点击图中端点可定位输入框。</p></details>
        </fieldset>
        <fieldset class="control-group"><legend>基线</legend>
          <label class="baseline-function"><span class="sr-only">基线函数</span><select v-model="baselineKind" data-test="baseline-kind" @change="notifyBaselineChange"><option value="none">无基线（直接拟合）</option><option value="constant">常数</option><option value="line">直线</option><option value="polynomial">Polynomial 多项式</option><option value="spline">Spline 插值样条</option><option value="bspline">B-Spline 平滑样条</option></select></label>
          <label v-if="baselineKind === 'polynomial'">多项式阶数<input v-model.number="degree" data-test="polynomial-degree" type="number" min="1" max="8" @input="notifyBaselineChange" /></label>
          <label v-if="baselineKind === 'bspline'">平滑强度<input v-model.number="smoothing" type="number" min="0" step="any" @input="notifyBaselineChange" /></label>
          <template v-if="baselineKind !== 'none'">
            <p class="hint baseline-summary" role="status">{{ anchorProgress }}</p>
            <details class="anchor-settings" :open="anchors.length > 0 || !['line', 'constant'].includes(baselineKind)">
              <summary>锚点精调<span>可选</span></summary>
              <div class="anchor-actions"><button v-if="baselineKind !== 'line' && x.length" data-test="suggest-anchors" type="button" @click="generateSuggestedAnchors">{{ anchors.length ? `重置为 ${recommendedAnchorCount} 个建议锚点` : `生成 ${recommendedAnchorCount} 个建议锚点` }}</button><button data-test="add-anchor" type="button" @click="addAnchor()">添加</button><button v-if="anchors.length" data-test="clear-anchors" type="button" @click="clearAnchors">清除全部</button></div>
              <p class="hint">锚点应取自背景区，编号对应图中标记；自动建议仍需复核。</p>
              <label v-if="anchorSource === 'suggested'" class="review-toggle"><input v-model="baselineConfirmed" data-test="confirm-suggested-anchors" type="checkbox" @change="confirmSuggestedAnchors" />我已复核建议锚点</label>
              <div v-if="orderedAnchors.length" class="anchor-grid-head" aria-hidden="true"><span>序号</span><span>X</span><span>Y</span><span/></div>
              <div v-for="item in orderedAnchors" :key="item.sourceIndex" data-test="anchor-row" class="anchor-row" :class="{ 'has-duplicate': item.duplicateOf }"><span data-test="anchor-number" class="anchor-number">{{ item.number }}</span><input v-model.number="item.anchor.x" data-test="anchor-x" :aria-label="`锚点 ${item.number} X`" type="number" step="any" @input="markAnchorsAsManual" /><input v-model.number="item.anchor.y" data-test="anchor-y" :aria-label="`锚点 ${item.number} Y`" type="number" step="any" @input="markAnchorsAsManual" /><button type="button" :aria-label="`删除锚点 ${item.number}`" @click="removeAnchor(item.sourceIndex)">×</button><p v-if="item.duplicateOf" data-test="duplicate-anchor-warning" class="anchor-duplicate">锚点 {{ item.duplicateOf }} 和 {{ item.number }} 的 X 坐标重合，不计为独立约束。</p></div>
            </details>
          </template>
          <p v-else class="hint">不扣除背景，适用于已完成背景校正的数据。</p>
          <div class="panel-action-row"><button data-test="preview-baseline" type="button" :disabled="!canPreviewBaseline" @click="previewBaseline">预览基线</button><p v-if="baselinePreviewed" class="success">已显示在主图</p></div>
        </fieldset>
        <details class="inline-help"><summary>基线与拟合的关系</summary><p class="hint">预览只计算基线。正式拟合会固定当前基线，仅优化峰参数；更改基线或区间后须重新拟合。</p></details>
      </section>
      <section v-show="activeControlTab === 'peak'" id="control-pane-peak" aria-labelledby="control-tab-peak" class="control-pane" role="tabpanel">
        <fieldset class="control-group"><legend>峰形</legend>
          <label class="peak-function"><span class="sr-only">峰形</span><select :value="model" data-test="peak-model" @change="updateModel(($event.target as HTMLSelectElement).value as PeakModel)"><optgroup v-for="group in MODEL_GROUPS" :key="group.label" :label="group.label"><option v-for="option in group.models" :key="option.id" :value="option.id">{{ option.label }}</option></optgroup></select></label>
          <div class="model-explainer"><p class="hint">{{ activeModel.shortDescription }}</p><span>{{ activeModel.formula }}</span><details class="inline-help"><summary>参数含义</summary><p class="hint">{{ activeModel.parameterMeaning }}</p></details></div>
        </fieldset>
        <section data-test="auto-analysis-card" class="auto-analysis-card"><button data-test="auto-analyze" type="button" :disabled="!canPreviewBaseline" @click="requestAutoAnalysis">自动估计并采用初值</button><div v-if="autoAnalysis && autoAnalysis.model === model" class="auto-analysis-result"><span>已采用初值 · 候选峰 {{ autoAnalysis.candidate_count }} 个</span><p v-for="warning in autoAnalysis.warnings" :key="warning" class="warning">{{warning}}</p></div></section>
        <section class="parameter-overview" aria-label="参数初值与约束摘要">
          <h3>参数初值与约束</h3>
          <dl><div v-for="name in parameterNames" :key="name"><dt>{{ name === 'mu' ? 'μ' : name }}</dt><dd>{{ parameterSummary(parameterDrafts[name].initial) }}<small v-if="parameterDrafts[name].fixed">固定</small><small v-else-if="parameterDrafts[name].lower || parameterDrafts[name].upper">已设边界</small></dd></div></dl>
          <button ref="parameterEditorButton" data-test="edit-parameters" type="button" aria-haspopup="dialog" aria-controls="parameter-editor" :aria-expanded="parameterDialogOpen" @click="openParameterEditor">编辑参数与约束</button>
        </section>
      </section>
      <section v-show="activeControlTab === 'fit'" id="control-pane-fit" aria-labelledby="control-tab-fit" class="control-pane" role="tabpanel">
        <fieldset class="control-group"><legend>求解策略</legend><label class="stage-toggle"><input v-model="stagedFit" type="checkbox" @change="notifySettingsChange" />固定峰中心预拟合，再释放中心</label></fieldset>
        <details class="advanced-parameters"><summary>求解参数<span>高级</span></summary><label v-if="stagedFit">中心固定阶段上限<input v-model.number="centerLockEvaluations" type="number" min="0" max="500" @input="notifySettingsChange" /></label><label>最大函数评估次数<input v-model.number="maxFunctionEvaluations" type="number" min="1" max="20000" @input="notifySettingsChange" /></label><label>收敛阈值<input v-model.number="tolerance" type="number" min="0.000000000001" max="0.1" step="any" @input="notifySettingsChange" /></label><p class="hint">次数指求解器函数评估次数，不等同于迭代轮数。</p></details>
      </section>
    </div>
    <dialog id="parameter-editor" ref="parameterDialog" class="parameter-dialog" aria-labelledby="parameter-editor-title" aria-describedby="parameter-editor-description" @close="onParameterEditorClosed">
      <header class="parameter-dialog-header"><div><h2 id="parameter-editor-title">参数初值与约束</h2><p class="hint">{{ activeModel.label }} · {{ parameterNames.length }} 个参数</p></div><button type="button" aria-label="关闭参数编辑" @click="closeParameterEditor">关闭</button></header>
      <div class="parameter-dialog-body">
        <p id="parameter-editor-description" class="hint">上下限留空使用默认边界；固定参数不参与优化。修改即时生效，关闭或 Esc 均保留修改。</p>
        <div class="parameter-editor-fields">
          <section v-for="name in parameterNames" :key="name" class="parameter-row" role="group" :aria-label="parameterLabel[name]">
            <strong class="parameter-name">{{ parameterLabel[name] }}</strong>
            <label class="parameter-initial">初值<input v-model.number="parameterDrafts[name].initial" :data-test="name === 'xc' ? 'initial-center' : `initial-${name}`" :aria-label="`${parameterLabel[name]} 初值`" :autofocus="name === 'A'" type="number" step="any" @input="notifySettingsChange" /></label>
            <label class="parameter-lower">下限<input v-model="parameterDrafts[name].lower" :data-test="`bound-${name}-lower`" :aria-label="`${parameterLabel[name]} 下限`" type="number" step="any" placeholder="自动" @input="notifySettingsChange" /></label>
            <label class="parameter-upper">上限<input v-model="parameterDrafts[name].upper" :data-test="`bound-${name}-upper`" :aria-label="`${parameterLabel[name]} 上限`" type="number" step="any" placeholder="自动" @input="notifySettingsChange" /></label>
            <label class="fixed-toggle"><input v-model="parameterDrafts[name].fixed" :data-test="`fixed-${name}`" :aria-label="`固定 ${parameterLabel[name]}`" type="checkbox" @change="notifySettingsChange" /><span>固定</span></label>
          </section>
        </div>
      </div>
      <footer class="parameter-dialog-footer"><p class="hint">返回设置后点击“开始拟合”。</p><button data-test="finish-parameters" type="button" class="primary" @click="closeParameterEditor">完成</button></footer>
    </dialog>
    <div class="fit-primary-footer"><button class="primary" data-test="fit-button" type="button" :disabled="!canFit" :aria-describedby="!canFit ? 'fit-blocker' : undefined" @click="runFit">{{ fitting ? "拟合中…" : "开始拟合" }}</button><p v-if="!canFit" id="fit-blocker" class="fit-blocker" role="status">{{ fitBlockedMessage }}</p></div>
  </section>
</template>
