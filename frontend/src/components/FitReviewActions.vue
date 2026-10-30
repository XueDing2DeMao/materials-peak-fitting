<script setup lang="ts">
import {computed} from 'vue';
import type {FitResult} from '../types';
import type {BatchResult} from '../batchTypes';
import {hasCorrelatedResiduals,resultDiagnostics} from '../resultDiagnostics';
const props=defineProps<{result:FitResult|BatchResult;stale?:boolean;busy?:boolean}>();
defineEmits<{navigate:[target:'baseline'|'peaks'|'chart'|'diagnostics']}>();
// 只使用已有结构化判定，不从警告文字推断某个峰有问题。
const residualIssue=computed(()=>'components' in props.result?hasCorrelatedResiduals(props.result.diagnostics.lag1_correlation):props.result.statistics.has_trend===true);
const peakIssue=computed(()=>resultDiagnostics(props.result).calculation!=='固定参数计算'&&(!props.result.converged||('components' in props.result&&(!props.result.diagnostics.identifiable||Boolean(props.result.diagnostics.strong_correlations?.length)))));
</script>
<template><section class="fit-review-actions" data-result-section="review" aria-label="建议复核操作">
 <h3>接下来检查什么</h3>
 <p v-if="stale" role="status">这些提示来自上次计算。请重新拟合后再处理诊断。</p>
 <template v-else>
  <p v-if="residualIssue">残差存在趋势或相邻相关性。先查看残差分布，再检查背景、区间与峰模型。</p>
  <p v-if="peakIssue">检查初值、峰数与约束是否合理；调整后重新拟合，并比较结果是否稳定。</p>
  <p v-if="!residualIssue&&!peakIssue">结合下方参数提示及残差图复核结果。没有诊断警告也不代表模型已验证。</p>
 </template>
 <div class="review-action-buttons">
  <button type="button" :disabled="stale||busy" data-test="review-chart" @click="$emit('navigate','chart')">查看图谱与残差</button>
  <button v-if="residualIssue" type="button" :disabled="stale||busy" data-test="review-baseline" @click="$emit('navigate','baseline')">检查基线设置</button>
  <button v-if="peakIssue" type="button" :disabled="stale||busy" data-test="review-peaks" @click="$emit('navigate','peaks')">检查峰数与约束</button>
  <button type="button" :disabled="busy" data-test="review-diagnostics" @click="$emit('navigate','diagnostics')">查看诊断详情</button>
 </div>
</section></template>
<style scoped>
.fit-review-actions{padding:10px;border:1px solid var(--ui-border);border-radius:6px;margin:10px 0;background:var(--ui-subtle)}
h3{font-size:14px;margin:0 0 6px}p{font-size:13px;line-height:1.6;margin:6px 0;overflow-wrap:anywhere}
.review-action-buttons{display:flex;gap:6px;flex-wrap:wrap}.review-action-buttons button{height:auto;min-height:36px;font-size:13px;white-space:normal;text-align:left}
</style>
