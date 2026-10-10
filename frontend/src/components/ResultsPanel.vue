<script setup lang="ts">
import { computed, ref } from "vue";
import PeakGeometryPanel from "./PeakGeometryPanel.vue";
import { overallWidthText } from "../peakGeometry";
import { peakModelInfo } from "../peakModels";
import type { FitResult, ModelComparison } from "../types";
const props = defineProps<{ result: FitResult | null; comparison?: ModelComparison | null; error?: string; fitting?: boolean; comparing?: boolean; stale?: boolean; analysisMode?: "single" | "xrd" }>();
const emit = defineEmits<{ export: [kind: "curves" | "parameters"]; "export-image": []; compare: [includeAsymmetric:boolean] }>();
const includeAsymmetric=ref(false);
function number(value: number | null | undefined): string { return value == null || !Number.isFinite(value) ? "—" : value.toPrecision(6); }
const xUnit = computed(() => props.analysisMode === "xrd" ? "°" : "X 单位");
const resultWarnings = computed(() => [...new Set([
  ...(props.result?.peak_geometry?.warnings ?? []),
  props.result?.analysis_metadata?.initialization_warning,
  props.result?.analysis_metadata?.uncertainty_warning,
].filter((warning): warning is string => Boolean(warning)))]);
const trendMessage = computed(() => props.result?.statistics.has_trend === true
  ? "残差存在明显趋势，请复核基线、区间或峰模型。"
  : props.result?.statistics.has_trend === false
    ? "未发现明显残差趋势，仍需结合残差图判断。"
    : "残差趋势未报告，请结合残差图判断。");
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
  <section class="panel results-panel">
    <header class="results-heading">
      <h2>拟合结果</h2>
      <span v-if="result" class="result-state">{{ stale ? '已过期' : fitting ? '拟合中' : result.converged ? '已收敛' : '未收敛' }}</span>
    </header>
    <div class="results-scroll">
      <p v-if="fitting" class="hint" role="status">拟合中…</p>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <template v-if="result">
        <p v-if="stale" data-test="stale-result-notice" class="stale-result" role="status"><strong>设置已变更，以下为上一次拟合。</strong> 重新拟合后可导出。</p>
        <p class="result-context"><strong>{{ peakModelInfo(result.model)?.label ?? result.model ?? '峰模型' }}</strong><span v-if="result.statistics.points">{{ result.statistics.points }} 个数据点</span></p>
        <dl class="result-key-values" aria-label="核心峰性质">
          <div><dt>{{ analysisMode === 'xrd' ? '峰顶 2θ' : '峰顶位置' }}</dt><dd data-test="result-peak-position">{{ number(result.peak_geometry?.peak_position) }} <small>{{ xUnit }}</small></dd></div>
          <div><dt>整体 FWHM</dt><dd data-test="result-fwhm">{{ number(result.peak_geometry?.fwhm) }} <small>{{ xUnit }}</small></dd></div>
          <div><dt>全峰面积</dt><dd>{{ number(result.peak_geometry?.area_total) }} <small>{{ analysisMode === 'xrd' ? '强度 × °' : 'Y × X 单位' }}</small></dd></div>
        </dl>
        <div class="result-quality" aria-label="拟合质量摘要">
          <div><span>R²</span><strong>{{ number(result.statistics.r_squared) }}</strong></div>
          <div><span>RMSE</span><strong>{{ number(result.statistics.rmse) }}</strong></div>
        </div>
        <p class="result-quality-note">收敛不代表模型一定适用。{{ trendMessage }}</p>
        <div v-if="resultWarnings.length || !result.converged" data-test="result-alerts" class="result-alerts" role="status">
          <strong>需要复核</strong>
          <p v-if="!result.converged">本次拟合未收敛，请检查区间、初值与参数约束。</p>
          <p v-for="warning in resultWarnings" :key="warning">{{ warning }}</p>
        </div>
        <p v-if="!result.peak_geometry" class="hint">摘要峰性质尚未计算，请重新拟合。{{ overallWidthText(result, xUnit) }}</p>
        <details class="result-details">
          <summary>峰参数与置信区间</summary>
          <table class="parameter-results"><tbody><tr v-for="(parameter, name) in result.parameters" :key="name"><th><span>{{ name }}</span><small v-if="parameterMeaning[String(name)]">{{ parameterMeaning[String(name)] }}</small></th><td><span class="parameter-value">{{ number(parameter.value) }}</span><span>± {{ number(parameter.standard_error) }}</span><span v-if="parameter.confidence_interval">95% CI {{ number(parameter.confidence_interval[0]) }} — {{ number(parameter.confidence_interval[1]) }}</span><span v-else>95% CI —</span><small v-if="parameter.uncertainty_reason">{{parameter.uncertainty_reason}}</small><span v-if="parameter.fixed" class="parameter-fixed">固定</span></td></tr></tbody></table>
        </details>
        <details class="result-details">
          <summary>连续峰性质</summary>
          <PeakGeometryPanel v-if="result.peak_geometry" :geometry="result.peak_geometry" :unit="xUnit" />
          <template v-if="!result.peak_geometry && result.derived_parameters"><h3>派生峰性质</h3><table><tbody><tr v-for="(value, name) in result.derived_parameters" :key="name"><th class="result-label"><span>{{ name }}</span><small>{{ derivedParameterMeaning(String(name)) }}</small></th><td>{{ number(value) }}</td></tr></tbody></table></template>
        </details>
        <details class="result-details">
          <summary>质量与残差指标</summary>
          <table><tbody>
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
      </tbody></table></section>
        </details>
        <details class="result-details" data-test="solver-details">
          <summary>求解过程</summary>
          <p class="hint">{{ peakModelInfo(result.model)?.formula }}</p>
          <p class="solver-message">{{ result.message }}</p>
          <div v-if="result.solver" class="fit-provenance"><span>求解器：<strong>{{ result.solver }}</strong></span><span v-if="result.iterations !== undefined">函数评估：{{ result.iterations }}</span></div>
      <section v-if="result.fit_stages?.length" class="fit-stages"><h3>分阶段拟合记录</h3><ol><li v-for="stage in result.fit_stages" :key="stage.name"><strong>{{ stage.name }}</strong><span>{{ stage.center_fixed ? '峰中心固定' : '峰中心释放' }} · {{ stage.evaluations }} 次函数评估 · {{ stage.converged ? '已完成' : '达到上限' }}</span></li></ol></section>
          <p v-if="result.analysis_metadata?.offset" class="scientific-note">{{ result.analysis_metadata.offset }}</p>
        </details>
        <details class="result-details" :open="comparing || !!comparison">
          <summary>模型比较</summary>
          <section class="comparison-panel"><div><p>在相同区间和基线下比较峰形，同名参数沿用约束；推荐模型需手动选择。</p><label><input v-model="includeAsymmetric" data-test="include-asymmetric" type="checkbox" />加入非对称模型</label></div><button data-test="compare-models" type="button" :disabled="comparing || fitting || stale" @click="emit('compare',includeAsymmetric)">{{ comparing ? "比较中…" : "比较模型" }}</button><table v-if="comparison" data-test="comparison-table"><thead><tr><th>模型</th><th>R²</th><th>RMSE</th><th>AICc</th><th>BIC</th></tr></thead><tbody><tr v-for="row in comparison.rows" :key="row.model" :class="{ recommended: row.model === comparison.recommended_model }"><td>{{ peakModelInfo(row.model)?.label ?? row.model }}<small v-if="row.model === comparison.recommended_model">推荐</small></td><td>{{ number(row.r_squared) }}</td><td>{{ number(row.rmse) }}</td><td>{{ number(row.aicc) }}</td><td>{{ number(row.bic) }}</td></tr></tbody></table></section>
        </details>
      </template>
      <p v-else-if="stale" class="stale-result" role="status">设置已变更，请重新拟合。</p>
      <p v-else class="hint">暂无拟合结果</p>
    </div>
    <footer v-if="result" class="result-export-footer">
      <p v-if="fitting" class="hint">拟合完成后可导出。</p>
      <div class="export-actions">
        <button type="button" :disabled="stale || fitting" @click="emit('export', 'curves')">曲线 CSV</button>
        <button type="button" :disabled="stale || fitting" @click="emit('export', 'parameters')">参数 CSV</button>
        <button data-test="export-image" type="button" :disabled="stale || fitting" @click="emit('export-image')">拟合图 PNG</button>
      </div>
    </footer>
  </section>
</template>
