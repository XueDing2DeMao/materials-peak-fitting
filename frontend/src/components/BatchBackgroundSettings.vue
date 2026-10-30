<script setup lang="ts">
import { computed } from 'vue';
import { isMulti } from '../fitAdapter';
import type { BatchRequest } from '../batchTypes';
import type { MultiPreview } from '../multipeakTypes';
import type { XpsPreview } from '../xpsTypes';
const props=defineProps<{request:BatchRequest|null;preview:MultiPreview|XpsPreview|null;unit:string}>();
const baseline=computed(()=>props.request&&isMulti(props.request)?props.request.baseline:null);
const background=computed(()=>props.request&&!isMulti(props.request)?props.request.background:null);
const anchors=computed(()=>props.preview&&'baseline_configuration' in props.preview?props.preview.baseline_configuration.resolved_anchors:baseline.value?.anchors??[]);
const resolved=computed(()=>props.preview&&'background' in props.preview?props.preview.background:null);
const names:Record<string,string>={none:'无背景',constant:'常数',line:'直线',polynomial:'多项式',spline:'Spline',bspline:'B-Spline',shirley:'静态 Shirley'};
// 参数保留原始数值字符串，不将展示舍入写回请求。
const value=(n:number|null|undefined)=>n==null?'自动':String(n);
</script>
<template>
  <section class="background-settings" aria-label="当前背景参数">
    <h4>背景设置 <span class="hint">来自拟合模板</span></h4>
    <template v-if="request">
      <dl>
        <div><dt>背景模型</dt><dd>{{names[baseline?.kind??background?.kind??'none']}}</dd></div>
        <div><dt>分析区间 / {{unit}}</dt><dd>{{request.range_start}} — {{request.range_end}}</dd></div>
        <template v-if="baseline">
          <div v-if="baseline.kind==='polynomial'"><dt>多项式阶数</dt><dd>{{baseline.degree}}</dd></div>
          <div v-if="baseline.kind==='bspline'"><dt>平滑系数</dt><dd>{{baseline.smoothing}}</dd></div>
          <div v-if="baseline.kind!=='none'"><dt>锚点来源</dt><dd>{{baseline.anchors.length?'模板显式锚点':'区间端点自动估计'}}</dd></div>
        </template>
        <template v-if="background">
          <div><dt>低能窗口</dt><dd>{{background.low_window?.join(' — ')??'自动'}}</dd></div>
          <div><dt>高能窗口</dt><dd>{{background.high_window?.join(' — ')??'自动'}}</dd></div>
          <div><dt>低端强度</dt><dd>{{value(resolved?.low_level??background.low_level)}}</dd></div>
          <div><dt>高端强度</dt><dd>{{value(resolved?.high_level??background.high_level)}}</dd></div>
          <template v-if="background.kind==='shirley'">
            <div><dt>容差</dt><dd>{{background.tolerance}}</dd></div>
            <div><dt>最大迭代</dt><dd>{{background.max_iterations}}</dd></div>
            <div v-if="resolved"><dt>预检迭代</dt><dd>{{resolved.iterations}} · {{resolved.converged?'收敛':'未收敛'}}</dd></div>
          </template>
        </template>
      </dl>
      <details v-if="anchors.length"><summary>查看实际锚点（{{anchors.length}}）</summary><table><thead><tr><th>X</th><th>Y</th></tr></thead><tbody><tr v-for="(anchor,i) in anchors" :key="i"><td>{{anchor.x}}</td><td>{{anchor.y}}</td></tr></tbody></table></details>
    </template>
    <p v-else class="hint">尚无有效背景配置，请完成预检。</p>
  </section>
</template>
<style scoped>
h4{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin:0 0 12px}dl{margin:0}dl>div{display:grid;gap:3px;margin:10px 0}dt{font-size:12px;color:var(--ui-text-muted)}dd{margin:0;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}summary{font-size:12px}table{width:100%;table-layout:fixed;font-size:12px}td{overflow-wrap:anywhere}
</style>
