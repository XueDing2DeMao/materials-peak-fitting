<script setup lang="ts">
import { ref, watch } from 'vue';
import PeakResultDialog from './PeakResultDialog.vue';
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
import { componentLine } from '../figureStyle';
import '../styles/peakResultTables.css';
const props=defineProps<{yUnit?:string;peaks:PresentedPeak[];unit:string;stale?:boolean;selectedPeak?:string;statusText?:string}>();
const emit=defineEmits<{select:[id:string]}>();
const dialog=ref<InstanceType<typeof PeakResultDialog>|null>(null),expanded=ref(''),showTotal=ref(false);
watch(()=>props.peaks,()=>dialog.value?.close());
function open(peak:PresentedPeak,event:Event){emit('select',peak.id);expanded.value=peak.id;void dialog.value?.open(peak,event);}
const percent=(v:number|null)=>v==null||!Number.isFinite(v)?'—':`${(v*100).toFixed(2)}%`;
</script>
<template>
  <div class="peak-table-tools" :class="{'has-status':Boolean(statusText)}">
    <p v-if="statusText" class="peak-table-status" role="status">{{statusText}}</p>
    <label class="result-area-toggle"><input v-model="showTotal" type="checkbox" />显示全域面积</label>
  </div>
  <div class="compact-result-table peak-metric-scroll" tabindex="0" role="region" aria-label="各峰结果对比">
    <table class="batch-peak-table peak-metric-table" :class="{'has-total-column':showTotal}" data-test="peak-overview">
      <colgroup><col class="peak-name-column" /><col :span="showTotal ? 5 : 4" /></colgroup>
      <thead><tr>
        <th scope="col"><span class="peak-name-heading">峰名称</span></th>
        <th scope="col">峰顶位置<small>{{unit}}</small></th>
        <th scope="col">整体 FWHM<small>{{unit}}</small></th>
        <th scope="col">区间面积<small>{{yUnit??'Y'}} × {{unit}}</small></th>
        <th v-if="showTotal" scope="col">全域面积<small>{{yUnit??'Y'}} × {{unit}}</small></th>
        <th scope="col">区间面积占比<small>%</small></th>
      </tr></thead>
      <tbody><tr v-for="peak in peaks" :key="peak.id" :class="{'peak-expanded':selectedPeak===peak.id}">
        <th scope="row"><button type="button" class="peak-detail-toggle peak-name-button" :data-test="`peak-select-${peak.id}`" aria-haspopup="dialog" :aria-expanded="expanded===peak.id" :title="`${peak.id} · ${peak.label}：查看参数与求解结果`" @click="open(peak,$event)"><span class="peak-result-mark" :style="{background:componentLine(peak.id).color}" aria-hidden="true" /><span class="peak-result-label">{{peak.id}} · {{peak.label}}</span></button></th>
        <td data-test="result-peak-position" :title="peak.geometry?.reasons.peak_position??(peak.geometry?.peak_position==null?'连续峰性质未计算，请重新拟合':'连续模型峰顶位置')">{{number(peak.geometry?.peak_position)}}</td><td data-test="result-fwhm" :title="peak.geometry?.reasons.fwhm??(peak.geometry?.fwhm==null?'连续峰性质未计算，请重新拟合':'连续模型整体 FWHM')">{{number(peak.geometry?.fwhm)}}</td><td>{{number(peak.areaWindow)}}</td><td v-if="showTotal">{{number(peak.areaTotal)}}</td><td>{{percent(peak.areaFraction)}}</td>
      </tr></tbody>
    </table>
  </div>
  <p class="hint compact-area-note">面积占比 = 本峰区间面积 / 全部启用峰区间面积之和，非原子百分比。点击峰名称查看参数，并突出对应曲线。</p>
  <PeakResultDialog ref="dialog" :unit="unit" :y-unit="yUnit" :stale="stale" @close="expanded=''" />
</template>
