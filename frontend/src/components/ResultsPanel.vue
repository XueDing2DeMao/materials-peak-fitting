<script setup lang="ts">
import { computed, ref } from "vue";
import PeakGeometryPanel from "./PeakGeometryPanel.vue";
import { overallWidthText } from "../peakGeometry";
import { peakModelInfo } from "../peakModels";
import type { FitResult, ModelComparison } from "../types";
const props = defineProps<{ result: FitResult | null; comparison?: ModelComparison | null; error?: string; fitting?: boolean; comparing?: boolean; stale?: boolean; analysisMode?: "single" | "xrd" }>();
const emit = defineEmits<{ export: [kind: "curves" | "parameters"]; "export-image": []; compare: [includeAsymmetric:boolean] }>();
const includeAsymmetric=ref(false);
function number(value: number | null): string { return value === null ? "—" : Number(value).toPrecision(6); }
const parameterMeaning = computed<Record<string, string>>(() => ({
  A: props.analysisMode === "xrd" ? "模型全域面积（强度 × °）" : "模型全域面积（Y × X 单位）",
  h_low: "低 X 侧半高半宽", h_high: "高 X 侧半高半宽", sigma: "高斯核标准差 σ（非整体 FWHM）", tau: "指数尾尺度 τ（非整体 FWHM）",
  xc: props.analysisMode === "xrd" ? "峰顶 2θ（°）" : "峰顶位置",
  w: props.analysisMode === "xrd" ? "半高全宽 FWHM（°）" : "半高全宽（FWHM）",
  wG: props.analysisMode === "xrd" ? "Gaussian 分量的半高全宽（°）" : "Gaussian 分量的半高全宽",
  wL: props.analysisMode === "xrd" ? "Lorentzian 分量的半高全宽（°）" : "Lorentzian 分量的半高全宽",
  mu: "Lorentzian 分量权重；1−μ 为 Gaussian 分量权重",
}));
const fitQualityMeaning = {
  rSquared: "模型解释的数据变异比例；越接近 1 越好",
  adjustedRSquared: "校正自由参数数量后的决定系数；越接近 1 越好",
  rmse: "典型拟合偏差；越小越好",
  rss: "残差平方和：总未解释偏差；越小越好",
  reducedChiSquare: "RSS / 自由度；单位为强度²，未按测量方差归一化",
  degreesOfFreedom: "数据点数减去自由参数数",
};
const residualMeaning = {
  mean: "残差均值：应接近 0",
  standardDeviation: "残差离散程度；越小越好",
  durbinWatson: "相邻残差相关性诊断；接近 2 更理想",
  outlierCount: "残差显著偏离的观测点数量",
};
const derivedMeaning: Record<string, string> = {
  area_total: "全峰积分面积",
  area_in_range: "采样点梯形积分面积（旧字段）",
  wG_fwhm: "Gaussian 分量 FWHM", wL_fwhm: "Lorentzian 分量 FWHM",
  peak_height: "峰顶相对基线的高度",
};
function derivedParameterMeaning(name: string): string {
  return derivedMeaning[name] ?? (name.endsWith("_fwhm") ? "半高全宽（FWHM）" : "由拟合参数推导的峰性质");
}
</script>

<template>
  <section class="panel results-panel"><h2>结果</h2>
    <p v-if="fitting" class="hint">正在进行有边界的非线性拟合…</p><p v-if="error" class="error">{{ error }}</p>
    <template v-if="result">
      <p v-if="stale" data-test="stale-result-notice" class="stale-result" role="status"><strong>当前设置已变更，以下为上一次拟合。</strong> 曲线和参数仅供对照；要获得当前分析区间、基线与参数约束下的正式结果，请重新开始拟合。</p>
      <div v-if="peakModelInfo(result.model)" class="result-model"><span>本次拟合：</span><strong>{{ peakModelInfo(result.model)?.label }}</strong><small>{{ peakModelInfo(result.model)?.formula }}</small></div>
      <p :class="result.converged ? 'success' : 'error'">{{ result.converged ? '已收敛' : '未收敛' }} · {{ result.message }}</p>
      <div v-if="result.solver" class="fit-provenance"><span>求解器：<strong>{{ result.solver }}</strong></span><span v-if="result.iterations !== undefined">函数评估：{{ result.iterations }}</span></div>
      <section v-if="result.fit_stages?.length" class="fit-stages"><h3>分阶段拟合记录</h3><ol><li v-for="stage in result.fit_stages" :key="stage.name"><strong>{{ stage.name }}</strong><span>{{ stage.center_fixed ? '峰中心固定' : '峰中心释放' }} · {{ stage.evaluations }} 次函数评估 · {{ stage.converged ? '已完成' : '达到上限' }}</span></li></ol></section>
      <PeakGeometryPanel v-if="result.peak_geometry" :geometry="result.peak_geometry" :unit="analysisMode==='xrd'?'°':undefined" />
      <p v-else class="hint">{{overallWidthText(result,analysisMode==='xrd'?'°':'X 单位')}}</p>
      <h3>峰参数</h3><table class="parameter-results"><tbody><tr v-for="(parameter, name) in result.parameters" :key="name"><th><span>{{ name }}</span><small v-if="parameterMeaning[String(name)]">{{ parameterMeaning[String(name)] }}</small></th><td><span class="parameter-value">{{ number(parameter.value) }}</span><span>± {{ number(parameter.standard_error) }}</span><span v-if="parameter.confidence_interval">95% CI {{ number(parameter.confidence_interval[0]) }} — {{ number(parameter.confidence_interval[1]) }}</span><span v-else>95% CI —</span><small v-if="parameter.uncertainty_reason">{{parameter.uncertainty_reason}}</small><span v-if="parameter.fixed" class="parameter-fixed">固定</span></td></tr></tbody></table>
      <h3>拟合质量</h3><table><tbody>
        <tr><th class="result-label"><span>R²</span><small>{{ fitQualityMeaning.rSquared }}</small></th><td>{{ number(result.statistics.r_squared) }}</td></tr>
        <tr><th class="result-label"><span>调整 R²</span><small>{{ fitQualityMeaning.adjustedRSquared }}</small></th><td>{{ number(result.statistics.adjusted_r_squared) }}</td></tr>
        <tr><th class="result-label"><span>RMSE</span><small>{{ fitQualityMeaning.rmse }}</small></th><td>{{ number(result.statistics.rmse) }}</td></tr>
        <tr><th class="result-label"><span>RSS</span><small>{{ fitQualityMeaning.rss }}</small></th><td>{{ number(result.statistics.sse) }}</td></tr>
        <tr v-if="result.statistics.reduced_chi_square !== undefined"><th class="result-label"><span>残差方差估计（强度²）</span><small>{{ fitQualityMeaning.reducedChiSquare }}</small></th><td>{{ number(result.statistics.reduced_chi_square ?? null) }}</td></tr>
        <tr v-if="result.statistics.degrees_of_freedom !== undefined"><th class="result-label"><span>自由度</span><small>{{ fitQualityMeaning.degreesOfFreedom }}</small></th><td>{{ result.statistics.degrees_of_freedom }}</td></tr>
      </tbody></table>
      <section class="residual-summary"><h3>残差诊断</h3><table><tbody>
        <tr><th class="result-label"><span>残差均值</span><small>{{ residualMeaning.mean }}</small></th><td>{{ number(result.statistics.residual_mean ?? null) }}</td></tr>
        <tr><th class="result-label"><span>残差标准差</span><small>{{ residualMeaning.standardDeviation }}</small></th><td>{{ number(result.statistics.residual_standard_deviation ?? null) }}</td></tr>
        <tr><th class="result-label"><span>Durbin–Watson</span><small>{{ residualMeaning.durbinWatson }}</small></th><td>{{ number(result.statistics.durbin_watson ?? null) }}</td></tr>
        <tr><th class="result-label"><span>异常点</span><small>{{ residualMeaning.outlierCount }}</small></th><td>{{ result.statistics.outlier_count ?? "—" }}</td></tr>
      </tbody></table><p class="diagnostic-status" :class="result.statistics.has_trend ? 'warning' : 'good'">{{ result.statistics.has_trend ? "残差与 X 存在明显趋势，建议复核基线、区间或峰模型。" : "未发现明显的残差趋势；请结合下方残差图判断。" }}</p></section>
      <template v-if="!result.peak_geometry && result.derived_parameters"><h3>派生峰性质</h3><table><tbody><tr v-for="(value, name) in result.derived_parameters" :key="name"><th class="result-label"><span>{{ name }}</span><small>{{ derivedParameterMeaning(String(name)) }}</small></th><td>{{ number(value) }}</td></tr></tbody></table></template>
      <p v-if="result.analysis_metadata?.offset" class="scientific-note">{{ result.analysis_metadata.offset }}</p>
      <p v-if="result.analysis_metadata?.initialization_warning" class="warning">{{result.analysis_metadata.initialization_warning}}</p>
      <p v-if="result.analysis_metadata?.uncertainty_warning" class="warning">{{result.analysis_metadata.uncertainty_warning}}</p>
      <section class="comparison-panel"><div><h3>模型比较</h3><p>默认比较四种对称峰；可主动加入非对称模型。保持相同区间和基线，按同名参数沿用约束；推荐不自动替换当前模型。</p><label><input v-model="includeAsymmetric" data-test="include-asymmetric" type="checkbox" />加入非对称模型</label></div><button data-test="compare-models" type="button" :disabled="comparing" @click="emit('compare',includeAsymmetric)">{{ comparing ? "比较中…" : "比较模型" }}</button><table v-if="comparison" data-test="comparison-table"><thead><tr><th>模型</th><th>R²</th><th>RMSE</th><th>AICc</th><th>BIC</th></tr></thead><tbody><tr v-for="row in comparison.rows" :key="row.model" :class="{ recommended: row.model === comparison.recommended_model }"><td>{{ peakModelInfo(row.model)?.label ?? row.model }}<small v-if="row.model === comparison.recommended_model">推荐</small></td><td>{{ number(row.r_squared) }}</td><td>{{ number(row.rmse) }}</td><td>{{ number(row.aicc) }}</td><td>{{ number(row.bic) }}</td></tr></tbody></table></section>
      <p v-if="stale" class="hint">重新拟合后可导出当前结果。</p>
      <div class="button-row export-actions"><button type="button" :disabled="stale" @click="emit('export', 'curves')">曲线 CSV</button><button type="button" :disabled="stale" @click="emit('export', 'parameters')">参数 CSV</button><button data-test="export-image" type="button" :disabled="stale" @click="emit('export-image')">拟合图 PNG</button></div>
    </template>
    <p v-else-if="stale" class="stale-result" role="status">设置已修改，请重新拟合。上一次的曲线和参数已隐藏，避免误读。</p>
    <p v-else class="hint">导入数据并设置基线后，结果会显示在这里。</p>
  </section>
</template>
