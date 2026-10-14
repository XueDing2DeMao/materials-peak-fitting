<script setup lang="ts">
import { ref, watch } from 'vue';
import PeakResultDialog from './PeakResultDialog.vue';
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
const props=defineProps<{peaks:PresentedPeak[];unit:string;stale?:boolean;selectedPeak?:string}>();
const emit=defineEmits<{select:[id:string]}>();
const dialog=ref<InstanceType<typeof PeakResultDialog>|null>(null),expanded=ref(''),showTotal=ref(false);
watch(()=>props.peaks,()=>dialog.value?.close());
function open(peak:PresentedPeak,event:Event){emit('select',peak.id);expanded.value=peak.id;void dialog.value?.open(peak,event);}
const percent=(v:number|null)=>v==null||!Number.isFinite(v)?'—':`${(v*100).toFixed(2)}%`;
</script>
<template>
  <label class="result-area-toggle"><input v-model="showTotal" type="checkbox" />显示全域面积</label>
  <div class="compact-result-table" tabindex="0" role="region" aria-label="各峰结果对比">
    <table class="batch-peak-table" data-test="peak-overview"><thead><tr><th>峰名称</th><th>峰顶位置<small>{{unit}}</small></th><th>整体 FWHM<small>{{unit}}</small></th><th>区间面积<small>Y × {{unit}}</small></th><th v-if="showTotal">全域面积<small>Y × {{unit}}</small></th><th>区间面积占比</th></tr></thead>
      <tbody><tr v-for="peak in peaks" :key="peak.id" :class="{'peak-expanded':selectedPeak===peak.id}">
        <th scope="row"><button class="peak-detail-toggle" :data-test="`peak-select-${peak.id}`" aria-haspopup="dialog" :aria-expanded="expanded===peak.id" title="查看此峰参数与求解结果" @click="open(peak,$event)">{{peak.id}} · {{peak.label}}</button></th>
        <td data-test="result-peak-position" :title="peak.geometry?.reasons.peak_position??(peak.geometry?.peak_position==null?'连续峰性质未计算，请重新拟合':'连续模型峰顶位置')">{{number(peak.geometry?.peak_position)}}</td><td data-test="result-fwhm" :title="peak.geometry?.reasons.fwhm??(peak.geometry?.fwhm==null?'连续峰性质未计算，请重新拟合':'连续模型整体 FWHM')">{{number(peak.geometry?.fwhm)}}</td><td>{{number(peak.areaWindow)}}</td><td v-if="showTotal">{{number(peak.areaTotal)}}</td><td>{{percent(peak.areaFraction)}}</td>
      </tr></tbody>
    </table>
  </div>
  <p class="hint compact-area-note">面积占比 = 本峰区间面积 / 全部启用峰区间面积之和，非原子百分比。点击峰名称查看参数，并突出对应曲线。</p>
  <PeakResultDialog ref="dialog" :unit="unit" :stale="stale" @close="expanded=''" />
</template>
