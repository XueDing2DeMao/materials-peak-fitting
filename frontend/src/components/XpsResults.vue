<script setup lang="ts">
import PeakGeometryPanel from "./PeakGeometryPanel.vue";
import { PARAMETER_LABELS, type PeakParameterName } from "../peakModels";
import type { XpsResult } from "../xpsTypes";
defineProps<{result:XpsResult|null;stale:boolean;busy:boolean}>();
const emit=defineEmits<{export:[kind:"curves"|"parameters"|"configuration"];image:[]}>();
const number=(v:number|null|undefined)=>v===null||v===undefined?"—":Number(v).toPrecision(6);
const metrics:Record<string,string>={r_squared:"R²（扣背景信号）",rmse:"RMSE",rss:"RSS",free_parameters:"独立自由参数",degrees_of_freedom:"自由度",residual_variance:"残差方差估计（强度²）",aicc:"AICc",bic:"BIC",durbin_watson:"Durbin–Watson"};
</script>
<template><section class="panel xps-results"><div class="panel-title"><h2>参数与诊断</h2></div>
  <p v-if="!result" class="hint">选择峰数与约束，预览背景后开始拟合。</p>
  <template v-else><p v-if="stale" class="xps-warning" data-test="xps-stale">设置已改变，以下结果已过期；请重新拟合后导出。</p>
    <div class="xps-status"><span :class="result.converged?'success':'error'">{{result.converged?'优化已收敛':'优化未收敛'}}</span><span>{{result.diagnostics.identifiable?'数值满秩':'不可独立辨识'}}</span><span>{{result.diagnostics.uncertainty_available?'条件标准误可用':'部分标准误不可用'}}</span></div>
    <p class="hint">模型适用性仍需复核。{{result.message}}（{{result.evaluations}} 次求值）</p>
    <table><tbody><tr v-for="(label,key) in metrics" :key="key"><th>{{label}}</th><td>{{number(result.statistics[key])}}</td></tr></tbody></table>
    <ul class="xps-warnings"><li v-for="warning in result.diagnostics.warnings" :key="warning">{{warning}}</li></ul>
    <details v-if="result.diagnostics.strong_correlations.length"><summary>强相关参数</summary><p v-for="pair in result.diagnostics.strong_correlations" :key="pair.a+pair.b" class="hint">{{pair.a}} / {{pair.b}}：{{number(pair.correlation)}}</p></details>
    <div v-for="c in result.components" :key="c.id" class="xps-component-result"><h3>{{c.id}} · {{c.label}} · {{c.model}}</h3><table><thead><tr><th>参数</th><th>值 ± 标准误</th></tr></thead><tbody><tr v-for="(p,name) in c.parameters" :key="name"><th>{{PARAMETER_LABELS[name as PeakParameterName]??name}}</th><td>{{number(p.value)}} ± {{number(p.standard_error)}}<small>{{p.linked_to?`绑定 ${p.linked_to}`:p.fixed?'固定':'自由'}}{{p.bound?' · 贴边':''}}{{p.uncertainty_reason?` · ${p.uncertainty_reason}`:''}}</small></td></tr></tbody></table><PeakGeometryPanel v-if="c.peak_geometry" :geometry="c.peak_geometry" unit="eV" /><p class="hint">该分量占全部启用峰区间面积：{{number(c.area_fraction_window===null?null:c.area_fraction_window*100)}}%</p><p v-if="!c.peak_geometry" class="hint">全域面积 {{number(c.area_total)}}<br/>区间面积 {{number(c.area_window)}} · 占比 {{number(c.area_fraction_window===null?null:c.area_fraction_window*100)}}%<br/>峰高 {{number(c.height)}} · FWHM {{number(c.fwhm)}} eV</p></div>
    <div v-for="g in result.groups" :key="g.id"><h3>{{g.id}} · {{g.label}}</h3><p class="hint">全域面积 {{number(g.area_total)}}<br/>区间面积 {{number(g.area_window)}} · 占比 {{number(g.area_fraction_window===null?null:g.area_fraction_window*100)}}%</p></div>
    <p class="hint">面积占比分母为当前能区内全部启用分量的积分面积之和，仅代表本模型内的组分比例，不是原子百分比。不同背景的 AICc/BIC 应分场景解释。</p>
    <div class="xps-actions"><button :disabled="stale||busy" @click="emit('export','curves')" data-test="xps-export-curves">曲线 CSV</button><button :disabled="stale||busy" @click="emit('export','parameters')">参数 CSV</button><button :disabled="stale||busy" @click="emit('export','configuration')" data-test="xps-export-config">配置 JSON</button><button :disabled="stale||busy" @click="emit('image')">谱图 PNG</button></div>
  </template>
</section></template>
