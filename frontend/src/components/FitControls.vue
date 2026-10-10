<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { MODEL_GROUPS, PEAK_MODEL_PARAMETERS, PARAMETER_LABELS, type PeakParameterName, peakModelInfo } from "../peakModels";
import type { Anchor, AutoPeakAnalysis, BaselineKind, FitRequest, PeakModel } from "../types";

const props = withDefaults(defineProps<{ x: number[]; y: number[]; baselinePreviewed?: boolean; autoAnalysis?: AutoPeakAnalysis | null; analysisMode?: "single" | "xrd" }>(), { baselinePreviewed: false, autoAnalysis: null, analysisMode: "single" });
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
const canFit = computed(() => canPreviewBaseline.value);
const missingAnchors = computed(() => Math.max(0, requiredAnchors.value - usableAnchorCount.value));
const anchorProgress = computed(() => {
  if (baselineKind.value === "none") return "不扣除基线：峰函数将直接拟合原始数据。";
  if ((baselineKind.value === "line" || baselineKind.value === "constant") && anchors.value.length === 0) return `未设置锚点：将自动估计${baselineKind.value === "line" ? "两端直线背景" : "背景常数"}。`;
  const count = anchors.value.length === usableAnchorCount.value ? `${usableAnchorCount.value}` : `${usableAnchorCount.value} 个有效（共 ${anchors.value.length} 个）`;
  if (missingAnchors.value) return `已设置 ${count} / ${requiredAnchors.value} 个，还差 ${missingAnchors.value} 个。`;
  if (!baselineIsApproved.value) return `已设置 ${count} / ${requiredAnchors.value} 个。辅助建议，未验证。`;
  return `已设置 ${count} / ${requiredAnchors.value} 个，可以拟合。`;
});
const fitBlockedMessage = computed(() => {
  if (props.x.length < 4) return "请先在左侧选择包含至少 4 个数值点的 X/Y 数据。";
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
    <div class="panel-title"><span class="step-number">2</span><div><h2>拟合设置</h2><p>自由切换设置；拟合时校验基线与参数条件。</p></div></div>
    <div class="control-tabs" role="tablist" aria-label="拟合设置页签">
      <button data-test="control-tab-baseline" type="button" role="tab" :aria-selected="activeControlTab === 'baseline'" :class="{ active: activeControlTab === 'baseline' }" @click="activeControlTab = 'baseline'">基线</button>
      <button data-test="control-tab-peak" type="button" role="tab" :aria-selected="activeControlTab === 'peak'" :class="{ active: activeControlTab === 'peak' }" @click="activeControlTab = 'peak'">峰模型与初值</button>
      <button data-test="control-tab-fit" type="button" role="tab" :aria-selected="activeControlTab === 'fit'" :class="{ active: activeControlTab === 'fit' }" @click="activeControlTab = 'fit'">高级控制</button>
    </div>

    <section v-show="activeControlTab === 'baseline'" class="control-pane" role="tabpanel">
      <p class="pane-intro">此处只估计与预览基线；不会单独执行峰拟合。所有设置会在一次“开始拟合”中共同求解。</p>
      <fieldset class="control-group"><legend>分析区间</legend><div class="field-grid"><label>起点 <input ref="rangeStartInput" v-model.number="rangeStart" data-test="range-start" type="number" step="any" @change="updateAnalysisRange" /></label><label>终点 <input ref="rangeEndInput" v-model.number="rangeEnd" data-test="range-end" type="number" step="any" @change="updateAnalysisRange" /></label></div><p class="hint range-helper">主图会标出起点和终点；点击图中同色圆点可定位对应输入框，使用图表工具栏的框选工具选择数据也可直接更新此区间。</p></fieldset>
      <fieldset class="control-group"><legend>基线</legend><p class="baseline-default">默认以分析区间两端估计直线背景。只有背景明显弯曲或有实验先验时，才需要改用更多锚点。</p><section class="baseline-adjustment"><div class="baseline-adjustment-title"><strong>基线处理</strong><span>可选精调</span></div><div class="baseline-adjustment-content"><label>基线函数<select v-model="baselineKind" data-test="baseline-kind" @change="notifyBaselineChange"><option value="none">无基线（直接拟合）</option><option value="constant">常数</option><option value="line">直线</option><option value="polynomial">Polynomial 多项式</option><option value="spline">Spline 插值样条</option><option value="bspline">B-Spline 平滑样条</option></select></label>
        <label v-if="baselineKind === 'polynomial'">多项式阶数 <input v-model.number="degree" data-test="polynomial-degree" type="number" min="1" max="8" @change="notifyBaselineChange" /></label><label v-if="baselineKind === 'bspline'">平滑强度 <input v-model.number="smoothing" type="number" min="0" step="any" @change="notifyBaselineChange" /></label>
        <template v-if="baselineKind !== 'none'"><div class="anchor-header"><div><strong>基线锚点</strong><p class="anchor-progress" role="status">{{ anchorProgress }}</p></div><div class="anchor-actions"><button v-if="baselineKind !== 'line' && x.length" data-test="suggest-anchors" type="button" @click="generateSuggestedAnchors">{{ anchors.length ? `重置为 ${recommendedAnchorCount} 个建议锚点` : `生成 ${recommendedAnchorCount} 个建议锚点` }}</button><button data-test="add-anchor" type="button" @click="addAnchor()">添加</button><button v-if="anchors.length" data-test="clear-anchors" type="button" @click="clearAnchors">清除全部</button></div></div>
        <p class="hint">橙色编号与图中锚点一一对应。建议点来自背景区的稳健估计，仍应按实验语义复核。</p><label v-if="anchorSource === 'suggested'" class="review-toggle"><input v-model="baselineConfirmed" data-test="confirm-suggested-anchors" type="checkbox" @change="confirmSuggestedAnchors" />我已复核建议锚点</label>
        <div v-if="orderedAnchors.length" class="anchor-grid-head" aria-hidden="true"><span>序号</span><span>X</span><span>Y</span><span/></div>
        <div v-for="item in orderedAnchors" :key="item.sourceIndex" data-test="anchor-row" class="anchor-row" :class="{ 'has-duplicate': item.duplicateOf }"><span data-test="anchor-number" class="anchor-number">{{ item.number }}</span><input v-model.number="item.anchor.x" data-test="anchor-x" :aria-label="`锚点 ${item.number} X`" type="number" step="any" @change="markAnchorsAsManual" /><input v-model.number="item.anchor.y" data-test="anchor-y" :aria-label="`锚点 ${item.number} Y`" type="number" step="any" @change="markAnchorsAsManual" /><button type="button" :aria-label="`删除锚点 ${item.number}`" @click="removeAnchor(item.sourceIndex)">×</button><p v-if="item.duplicateOf" data-test="duplicate-anchor-warning" class="anchor-duplicate">锚点 {{ item.duplicateOf }} 和 {{ item.number }} 的 X 坐标重合，不计为独立约束。</p></div></template>
        <p v-else class="scientific-note">无基线不会扣除背景，适合已完成背景校正的数据。若存在连续背景，请选择常数、直线或样条基线。</p>
        </div></section></fieldset>
      <div class="panel-action-row"><button data-test="preview-baseline" type="button" :disabled="!canPreviewBaseline" @click="previewBaseline">查看自动基线（可选）</button><p v-if="baselinePreviewed" class="success">已在主图显示计算基线。</p></div>
    </section>

    <section v-show="activeControlTab === 'peak'" class="control-pane" role="tabpanel">
      <p class="pane-intro">选择峰函数，并按实验先验调整初值、边界或固定参数。</p>
      <fieldset class="control-group"><legend>峰模型</legend><div v-for="group in MODEL_GROUPS" :key="group.label"><h4>{{group.label}}</h4><div class="model-card-grid" role="group" aria-label="峰函数"><button v-for="option in group.models" :key="option.id" :data-test="`model-${option.id}`" :class="{ active: model === option.id }" :aria-pressed="model === option.id" type="button" @click="updateModel(option.id)"><strong>{{ option.label }}</strong><small>{{ option.shortDescription }}</small></button></div></div><div class="model-explainer"><strong>当前：{{ activeModel.label }}</strong><span>{{ activeModel.formula }}</span><small>{{ activeModel.parameterMeaning }}</small></div></fieldset>
      <section data-test="auto-analysis-card" class="auto-analysis-card"><div><strong>自动单峰分析</strong><p>根据当前基线和所选模型估计峰中心、FWHM 与面积初值。</p></div><button data-test="auto-analyze" type="button" :disabled="!canPreviewBaseline" @click="requestAutoAnalysis">自动分析并采用初值</button><div v-if="autoAnalysis && autoAnalysis.model === model" class="auto-analysis-result"><span>已采用自动初值 · 候选峰 {{ autoAnalysis.candidate_count }} 个 · 中心 {{ autoAnalysis.initial_parameters.xc?.toPrecision(6) }}</span><p v-for="warning in autoAnalysis.warnings" :key="warning" class="warning">{{warning}}</p></div></section>
      <details class="advanced-parameters"><summary>参数初值与约束 <span>可选</span></summary><p class="hint">留空的上下限将采用模型安全边界；“固定”表示该参数不参与优化。</p><div class="parameter-table"><div class="parameter-head"><span>参数</span><span>初值</span><span>下限</span><span>上限</span><span>固定</span></div><div v-for="name in parameterNames" :key="name" class="parameter-row"><span>{{ parameterLabel[name] }}</span><input v-model.number="parameterDrafts[name].initial" :data-test="name === 'xc' ? 'initial-center' : `initial-${name}`" :aria-label="`${parameterLabel[name]} 初值`" type="number" step="any" @change="notifySettingsChange" /><input v-model="parameterDrafts[name].lower" :data-test="`bound-${name}-lower`" :aria-label="`${parameterLabel[name]} 下限`" type="number" step="any" placeholder="自动" @change="notifySettingsChange" /><input v-model="parameterDrafts[name].upper" :data-test="`bound-${name}-upper`" :aria-label="`${parameterLabel[name]} 上限`" type="number" step="any" placeholder="自动" @change="notifySettingsChange" /><label class="fixed-toggle"><input v-model="parameterDrafts[name].fixed" :data-test="`fixed-${name}`" :aria-label="`固定 ${parameterLabel[name]}`" type="checkbox" @change="notifySettingsChange" /><span>固定</span></label></div></div></details>
    </section>

    <section v-show="activeControlTab === 'fit'" class="control-pane" role="tabpanel">
      <p class="pane-intro">拟合时先固定当前基线，再仅优化峰参数。完成后在主图和残差图检查结果。</p><details class="advanced-parameters" open><summary>分阶段拟合 <span>自动</span></summary><label class="stage-toggle"><input v-model="stagedFit" type="checkbox" @change="notifySettingsChange" />固定峰中心预拟合后再释放中心</label><div v-if="stagedFit" class="field-grid"><label>中心固定阶段上限 <input v-model.number="centerLockEvaluations" type="number" min="0" max="500" @change="notifySettingsChange" /></label><label>最大函数评估次数 <input v-model.number="maxFunctionEvaluations" type="number" min="1" max="20000" @change="notifySettingsChange" /></label></div><label>收敛阈值 <input v-model.number="tolerance" type="number" min="0.000000000001" max="0.1" step="any" @change="notifySettingsChange" /></label><p class="hint">为避免误导，“次数”按求解器函数评估次数记录，而非伪造的迭代轮数。</p></details><p class="scientific-note">结果包含总拟合、残差、面积及置信区间；若基线、区间或锚点改变，需要重新拟合。</p>
    </section>
    <div class="fit-primary-footer"><button class="primary" data-test="fit-button" type="button" :disabled="!canFit" aria-describedby="fit-blocker" @click="runFit">开始拟合</button><p v-if="!canFit" id="fit-blocker" class="fit-blocker" role="status">{{ fitBlockedMessage }}</p><p v-else class="hint">一次正式拟合：固定当前基线，同时优化峰模型参数。基线预览不会产生正式结果。</p></div>
  </section>
</template>
