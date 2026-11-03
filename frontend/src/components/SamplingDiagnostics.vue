<script setup lang="ts">
import {samplingDiagnostics} from '../samplingDiagnostics';
import type {PresentedPeak} from '../resultPresentation';
import {computed} from 'vue';
const props=defineProps<{x:number[];peaks:PresentedPeak[];unit:string;xrd?:boolean}>();
const rows=computed(()=>props.peaks.map(p=>({...p,sampling:samplingDiagnostics(props.x,p.geometry)})));
const fmt=(v:number|null)=>v==null?'—':Number(v.toPrecision(6)).toString();
</script>
<template>
  <details class="result-details sampling-diagnostics"><summary>采样支持与峰宽解释</summary>
    <p v-if="xrd" class="hint">XRD：观测峰宽，未扣除仪器展宽；不能直接解释为晶粒尺寸。</p>
    <div class="compact-result-table diagnostic-table-scroll" tabindex="0" role="region" aria-label="半高区间采样支持">
      <table class="diagnostic-sampling">
        <colgroup><col class="sampling-name-col" /><col class="sampling-count-col" /><col class="sampling-interval-col" /><col /></colgroup>
        <thead><tr><th scope="col">峰名称</th><th scope="col">半高区间实际点数</th><th scope="col">局部间隔<small>最小 / 中位 / 最大 · {{unit}}</small></th><th scope="col">说明</th></tr></thead><tbody>
      <tr v-for="p in rows" :key="p.id"><th>{{p.id}} · {{p.label}}</th><td>{{p.sampling.count??'—'}}</td><td>{{fmt(p.sampling.minimum)}} / {{fmt(p.sampling.median)}} / {{fmt(p.sampling.maximum)}}</td><td>{{p.sampling.reason}} {{p.sampling.extrapolated?'半高点超出实际观测范围，含模型外推。':''}}</td></tr>
    </tbody></table></div>
    <p class="hint">按拟合所用观测点计算，不设统一“合格点数”阈值。参数标准误以当前模型和数据假设为条件；派生峰宽、面积未计算标准误。方案间差异不是置信区间。</p>
  </details>
</template>
