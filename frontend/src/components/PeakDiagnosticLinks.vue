<script setup lang="ts">
import { computed } from 'vue';
import {PARAMETER_LABELS,type PeakParameterName} from '../peakModels';
import type { PresentedPeak } from '../resultPresentation';
const props=defineProps<{peaks:PresentedPeak[];stale?:boolean;busy?:boolean;correlations?:Array<{a:string;b:string;correlation:number}>}>();
defineEmits<{locate:[id:string,parameter:string]}>();
// 仅使用结果里明确的峰 ID 与参数字段，不从自然语言警告猜测关联。
const issues=computed(()=>props.peaks.flatMap(peak=>Object.entries(peak.parameters)
  .filter(([,parameter])=>!parameter.fixed&&(parameter.bound||parameter.uncertainty_reason))
  .map(([name,parameter])=>({id:peak.id,name,reason:parameter.bound?'参数位于边界'+(parameter.uncertainty_reason?'；'+parameter.uncertainty_reason:''):parameter.uncertainty_reason??'参数位于边界',suggestion:parameter.bound?'检查上下限与初值是否有依据，不要只为消除警告而放宽边界。':'检查固定、关联与模型假设；标准误缺失不代表误差为零。'})))
  .concat((props.correlations??[]).flatMap(pair=>props.peaks.flatMap(peak=>Object.keys(peak.parameters)
    .filter(name=>[pair.a,pair.b].includes(`${peak.id}.${name}`))
    .map(name=>({id:peak.id,name,suggestion:'检查两端参数的关联、峰数及区间，比较不同合理初值下的稳定性。',reason:`与 ${pair.a===`${peak.id}.${name}`?pair.b:pair.a} 强相关（r=${pair.correlation.toPrecision(6)}）`})))))
);
</script>
<template><section v-if="issues.length" class="peak-diagnostic-links" data-result-section="review" aria-label="定位参数诊断">
  <h3>定位参数诊断</h3><p v-if="stale" class="hint">以下诊断来自上次计算，请重新拟合后再定位处理。</p>
  <button v-for="issue in issues" :key="`${issue.id}.${issue.name}:${issue.reason}`" type="button" :disabled="stale||busy" @click="$emit('locate',issue.id,issue.name)"><strong>{{peaks.find(p=>p.id===issue.id)?.label || issue.id}} · {{PARAMETER_LABELS[issue.name as PeakParameterName] || issue.name}}（{{issue.id}}）</strong><span class="issue-reason">{{issue.reason}}</span><small>{{issue.suggestion}}</small><span class="diagnostic-locate-label">定位参数 →</span></button>
</section></template>
