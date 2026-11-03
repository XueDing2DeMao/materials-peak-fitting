<script setup lang="ts">
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
import { componentLine } from '../figureStyle';
import '../styles/peakResultTables.css';
defineProps<{yUnit?:string;peaks:PresentedPeak[];unit:string;selectedPeak?:string;stale?:boolean;busy?:boolean}>();
defineEmits<{select:[id:string]}>();
</script>
<template>
  <div class="single-peak-summary" data-result-section="overview">
    <div class="peak-metric-scroll" tabindex="0" role="region" aria-label="各峰结果概览">
    <table class="peak-summary-table peak-metric-table">
      <colgroup><col class="peak-name-column" /><col span="4" /></colgroup>
      <thead><tr>
        <th scope="col"><span class="peak-name-heading">峰名称</span></th>
        <th scope="col">优化后 xc<small>{{unit}}</small></th>
        <th scope="col">峰顶位置<small>{{unit}}</small></th>
        <th scope="col">整体 FWHM<small>{{unit}}</small></th>
        <th scope="col">区间面积<small>{{yUnit??'Y'}} × {{unit}}</small></th>
      </tr></thead>
      <tbody>
        <tr v-for="peak in peaks" :key="peak.id" :class="{'is-selected':selectedPeak===peak.id}">
          <th scope="row"><button class="peak-name-button" type="button" :disabled="stale||busy" :aria-pressed="selectedPeak===peak.id" :data-test="`locate-peak-${peak.id}`" @click="$emit('select',peak.id)" :title="`${peak.id} · ${peak.label}：定位输入参数`"><span class="peak-result-mark" :style="{background:componentLine(peak.id).color}" aria-hidden="true" /><span class="peak-result-label">{{peak.id}} · {{peak.label}}</span></button></th>
          <td>{{number(peak.parameters.xc?.value)}}</td>
          <td>{{number(peak.geometry?.peak_position)}}</td>
          <td>{{number(peak.geometry?.fwhm)}}</td>
          <td>{{number(peak.areaWindow)}}</td>
        </tr>
      </tbody>
    </table>
    </div>
    <small v-if="stale">上次计算结果，需重新拟合</small>
  </div>
</template>
