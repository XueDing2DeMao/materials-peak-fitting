<script setup lang="ts">
import type { PeakGeometry } from "../peakGeometry";
defineProps<{yUnit?:string;geometry:PeakGeometry; unit?:string}>();
const rows = [
  ['peak_position','峰顶位置','x'],['fwhm','整体 FWHM','x'],
  ['hwhm_low','低 X 侧半高半宽','x'],['hwhm_high','高 X 侧半高半宽','x'],
  ['peak_height','净峰高','y'],['area_total','模型全域面积','area'],
  ['area_in_range','当前区间模型面积','area'],['area_fraction_in_range','区间覆盖比例','fraction'],
] as const;
function value(g:PeakGeometry,key:typeof rows[number][0]) {
  const v=g[key];return v==null?'—':key==='area_fraction_in_range'?`${(v*100).toFixed(2)}%`:v.toPrecision(6);
}
</script>
<template>
  <div class="geometry-panel">
    <h4>连续模型峰性质</h4>
    <table><thead><tr><th>性质</th><th>数值</th><th>单位 / 说明</th></tr></thead>
      <tbody><tr v-for="[key,label,kind] in rows" :key="key"><td>{{label}}</td><td>{{value(geometry,key)}}</td>
        <td>{{geometry.reasons[key]??(kind==='x'?(unit||'X 单位'):kind==='y'?(yUnit||'Y 单位'):kind==='area'?`${yUnit||'Y'} × ${unit||'X 单位'}`:'无量纲')}}</td></tr></tbody>
    </table>
    <p v-if="geometry.peak_height_uncertainty" class="hint" data-test="height-uncertainty">
      净峰高标准误
      <template v-if="geometry.peak_height_uncertainty.standard_error != null">{{geometry.peak_height_uncertainty.standard_error.toPrecision(6)}} {{yUnit||'Y 单位'}}</template>
      <template v-else>—</template> · 95% 置信区间
      <template v-if="geometry.peak_height_uncertainty.confidence_interval">{{geometry.peak_height_uncertainty.confidence_interval.map(v=>v.toPrecision(6)).join(' — ')}} {{yUnit||'Y 单位'}}</template>
      <template v-else>—</template>
      <span v-if="geometry.peak_height_uncertainty.reason">（{{geometry.peak_height_uncertainty.reason}}）</span>
    </p>
    <details class="ui-help"><summary>计算口径与不确定度</summary>
      <p>面积 A 为模型全域积分，区间外为模型外推。{{geometry.area_method}}；{{geometry.width_method}}。</p>
      <p>{{geometry.uncertainty_note}}</p>
    </details>
    <p v-for="warning in geometry.warnings" :key="warning" class="warning">{{warning}}</p>
  </div>
</template>
