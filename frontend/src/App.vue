<script setup lang="ts">
import { computed, ref } from "vue";
import { analyzePeak, compareModels, downloadExport, previewBaseline, previewDataset, runFit, uploadDataset } from "./api";
import DatasetSummary from "./components/DatasetSummary.vue";
import FitChart from "./components/FitChart.vue";
import FitControls from "./components/FitControls.vue";
import ResultsPanel from "./components/ResultsPanel.vue";
import XpsWorkbench from "./components/XpsWorkbench.vue";
import { RevisionGate } from "./xpsState";
import type { XpsSource } from "./xpsTypes";
import type { Anchor, AutoPeakAnalysis, BaselinePreview, DatasetInfo, FitRequest, FitResult, ModelComparison } from "./types";

const dataset = ref<DatasetInfo | null>(null); const x = ref<number[]>([]); const y = ref<number[]>([]); const result = ref<FitResult | null>(null); const baselinePreview = ref<BaselinePreview | null>(null); const autoAnalysis = ref<AutoPeakAnalysis | null>(null); const comparison = ref<ModelComparison | null>(null);
const resultStale = ref(false);
const fitGate = new RevisionGate();
let fitSequence = 0;
const advisoryGate=new RevisionGate();
const mode = ref<"single" | "xrd" | "xps">("single");
const workflowDescriptions = {
  single: "适用于 Raman 等一维谱线。",
  xrd: "X 列须为 2θ（°）。",
  xps: "X 列须为结合能（eV）。",
};
const singleMode = computed(() => mode.value === "xrd" ? "xrd" : "single");
const selectionIdentity = ref<{sheet:string;xColumn:string;yColumn:string}|null>(null);
let selectionVersion = 0;
const xpsSource = computed<XpsSource|null>(()=>dataset.value?.file_sha256&&selectionIdentity.value?{
  filename:dataset.value.filename,file_sha256:dataset.value.file_sha256,sheet:selectionIdentity.value.sheet,
  x_column:selectionIdentity.value.xColumn,y_column:selectionIdentity.value.yColumn}:null);
const loading = ref(false); const previewLoading = ref(false); const fitting = ref(false); const comparing = ref(false); const inputError = ref(""); const fitError = ref("");
const controls = ref<{
  addAnchor: (anchor: Anchor) => void;
  buildFitRequest: () => FitRequest;
  setAnalysisRange: (range: { start: number; end: number }) => void;
  focusRangeEndpoint: (endpoint: "start" | "end") => void;
} | null>(null);
const chart = ref<{ downloadImage: () => void } | null>(null);
const anchors = ref<Anchor[]>([]);
const analysisRange = ref<{ start: number; end: number } | null>(null);
function invalidatePendingFit(): void {
  fitGate.invalidate();
  fitSequence += 1;
  fitting.value = false;
  fitError.value = "";
}
function clearFit(): void { invalidatePendingFit(); advisoryGate.invalidate(); result.value = null; comparison.value = null; resultStale.value = false; baselinePreview.value = null; autoAnalysis.value = null; analysisRange.value = null; }
function invalidateFit(): void { invalidatePendingFit(); advisoryGate.invalidate(); comparison.value = null; if (result.value) resultStale.value = true; }
function invalidateBaseline(): void { baselinePreview.value = null; invalidateFit(); }
async function importFile(file: File): Promise<void> {
  if (loading.value) return;
  loading.value = true; inputError.value = ""; selectionVersion++; previewLoading.value = false;
  try {
    const uploaded = await uploadDataset(file);
    x.value = []; y.value = []; selectionIdentity.value = null;
    dataset.value = uploaded; clearFit(); anchors.value = [];
  } catch (error) {
    const message = error instanceof Error ? error.message : "文件读取失败";
    inputError.value = `新文件读取失败：${message}${dataset.value ? `；当前仍为 ${dataset.value.filename}` : ""}`;
  } finally { loading.value = false; }
}
async function preview(selection: { sheet: string; xColumn: string; yColumn: string }): Promise<void> {
  if (!dataset.value) return;
  const version = ++selectionVersion;
  inputError.value = ""; previewLoading.value = true;
  try {
    const data = await previewDataset(dataset.value.dataset_id, selection.sheet, selection.xColumn, selection.yColumn);
    if (version !== selectionVersion) return;
    // 成功后一次提交数据及其身份，失败时保留上一份已应用数据。
    x.value = data.x; y.value = data.y; selectionIdentity.value = { ...selection };
    clearFit(); anchors.value = [];
  } catch (error) {
    if (version === selectionVersion) inputError.value = `数据列应用失败：${error instanceof Error ? error.message : "无法显示数据"}${selectionIdentity.value ? "；当前图表仍为上一次已应用数据" : "；请重新选择数据列"}`;
  } finally { if (version === selectionVersion) previewLoading.value = false; }
}
async function fit(payload: FitRequest): Promise<void> {
  if (fitting.value || loading.value || previewLoading.value) return;
  const sequence = ++fitSequence, token = fitGate.start("fit");
  fitting.value = true; fitError.value = "";
  try {
    const data = await runFit(payload);
    if (fitGate.current(token)) { result.value = data; resultStale.value = false; }
  } catch (error) {
    if (fitGate.current(token)) fitError.value = error instanceof Error ? error.message : "拟合失败";
  } finally { if (sequence === fitSequence) fitting.value = false; }
}
async function showBaselinePreview(payload: FitRequest): Promise<void> {
  const token=advisoryGate.start('baseline');fitError.value='';
  try{const data=await previewBaseline(payload);if(advisoryGate.current(token))baselinePreview.value=data;}
  catch(error){if(advisoryGate.current(token))fitError.value=error instanceof Error?error.message:'基线预览失败';}
}
async function requestAutoAnalysis(payload: FitRequest): Promise<void> {
  const token=advisoryGate.start('auto');fitError.value='';
  try{const data=await analyzePeak(payload);if(advisoryGate.current(token))autoAnalysis.value=data;}
  catch(error){if(advisoryGate.current(token))fitError.value=error instanceof Error?error.message:'自动峰分析失败';}
}
async function requestModelComparison(includeAsymmetric=false): Promise<void> {
  if(!controls.value||comparing.value)return;
  const token=advisoryGate.start('compare');comparing.value=true;fitError.value='';
  try{const data=await compareModels(controls.value.buildFitRequest(),includeAsymmetric);if(advisoryGate.current(token))comparison.value=data;}
  catch(error){if(advisoryGate.current(token))fitError.value=error instanceof Error?error.message:'模型比较失败';}
  finally{comparing.value=false;}
}
async function download(kind: "curves" | "parameters"): Promise<void> { if (!result.value || resultStale.value) return; try { const blob = await downloadExport(kind, result.value); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = kind === "curves" ? "curves.csv" : "parameters.csv"; link.click(); URL.revokeObjectURL(link.href); } catch (error) { fitError.value = error instanceof Error ? error.message : "导出失败"; } }
</script>
<template>
  <main class="analysis-workbench">
    <header class="workbench-header">
      <div class="product-identity"><span class="product-mark" aria-hidden="true">∿</span><h1>谱线拟合工作台</h1></div>
      <div class="header-status"><span class="local-dot"/>本机处理 <label class="mode-select">拟合工作流<select v-model="mode" aria-label="拟合工作流" aria-describedby="workflow-description" data-test="analysis-mode"><option value="single">通用单峰拟合</option><option value="xrd">XRD 单峰拟合</option><option value="xps">XPS 多峰拟合</option></select></label><p id="workflow-description" class="workflow-description">{{ workflowDescriptions[mode] }}</p></div>
    </header>

    <DatasetSummary :dataset="dataset" :loading="loading" :preview-loading="previewLoading" :applied-selection="selectionIdentity" :point-count="x.length" :error="inputError" @upload="importFile" @preview="preview" />

    <KeepAlive><XpsWorkbench v-if="mode==='xps'" :x="x" :y="y" :source="xpsSource" /></KeepAlive>
    <div v-show="mode!=='xps'" class="workbench-grid">
      <aside class="workbench-controls" aria-label="拟合控制">
        <FitControls ref="controls" :analysis-mode="singleMode" :fitting="fitting" :data-loading="loading || previewLoading" :x="x" :y="y" :baseline-previewed="Boolean(baselinePreview)" :auto-analysis="autoAnalysis" @fit="fit" @preview-baseline="showBaselinePreview" @auto-analyze="requestAutoAnalysis" @settings-change="invalidateFit" @baseline-change="invalidateBaseline" @anchors-change="anchors = $event" @range-change="analysisRange = $event" />
      </aside>
      <section class="workbench-analysis" aria-label="分析图表">
        <FitChart ref="chart" :analysis-mode="singleMode" :x="x" :y="y" :anchors="anchors" :analysis-range="analysisRange" :baseline-preview="baselinePreview" :result="result" :stale="resultStale" @anchor="controls?.addAnchor" @range="controls?.setAnalysisRange" @range-endpoint-focus="controls?.focusRangeEndpoint" />
      </section>
      <aside class="workbench-results" aria-label="拟合结果">
        <ResultsPanel :analysis-mode="singleMode" :result="result" :comparison="comparison" :stale="resultStale" :fitting="fitting" :comparing="comparing" :error="fitError" @compare="requestModelComparison" @export="download" @export-image="chart?.downloadImage" />
      </aside>
    </div>
  </main>
</template>
