<script setup lang="ts">
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
import { componentLine } from '../figureStyle';
defineProps<{peaks:PresentedPeak[];unit:string;selectedPeak?:string;stale?:boolean;busy?:boolean}>();
defineEmits<{select:[id:string]}>();
</script>
<template><div class="single-peak-summary" data-result-section="overview">
  <section v-for="peak in peaks" :key="peak.id" :class="{'is-selected':selectedPeak===peak.id}" :style="{'--peak-color':componentLine(peak.id).color}">
    <button type="button" :disabled="stale||busy" :aria-pressed="selectedPeak===peak.id" :data-test="`locate-peak-${peak.id}`" @click="$emit('select',peak.id)" :title="`${peak.id} · ${peak.label}：定位输入参数`">{{peak.id}} · {{peak.label}} <span>定位</span></button>
    <dl><div><dt>优化后 xc / {{unit}}</dt><dd>{{number(peak.parameters.xc?.value)}}</dd></div><div><dt>峰顶位置 / {{unit}}</dt><dd>{{number(peak.geometry?.peak_position)}}</dd></div><div><dt>整体 FWHM / {{unit}}</dt><dd>{{number(peak.geometry?.fwhm)}}</dd></div><div><dt>区间面积 / Y × {{unit}}</dt><dd>{{number(peak.areaWindow)}}</dd></div></dl>
    <small v-if="stale">上次计算结果，需重新拟合</small>
  </section>
</div></template>
