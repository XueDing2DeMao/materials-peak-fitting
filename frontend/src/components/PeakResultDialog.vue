<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue';
import PeakGeometryPanel from './PeakGeometryPanel.vue';
import { PARAMETER_LABELS, peakModelInfo, type PeakParameterName } from '../peakModels';
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
defineProps<{unit:string;stale?:boolean}>();
const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement|null>(null),selected=ref<PresentedPeak|null>(null);
let trigger:HTMLElement|null=null;
async function open(peak:PresentedPeak,event:Event){
  trigger=event.currentTarget as HTMLElement;selected.value=peak;
  await nextTick();if(selected.value&&!dialog.value?.open)dialog.value?.showModal();
}
function close(restoreFocus=true){
  const previous=trigger;trigger=null;selected.value=null;
  if(dialog.value?.open)dialog.value.close();
  if(restoreFocus&&previous?.isConnected)previous.focus({preventScroll:true});emit('close');
}
onDeactivated(()=>close(false));onBeforeUnmount(()=>close(false));
defineExpose({open,close});
</script>
<template>
  <dialog ref="dialog" class="parameter-dialog peak-result-dialog" data-test="peak-result-dialog" :aria-label="selected?`${selected.id} · ${selected.label} 详细求解结果`:'峰详细求解结果'" @cancel.prevent="close()" @close="close()">
    <div v-if="selected" class="peak-detail-content" data-test="peak-detail">
      <header class="parameter-dialog-header"><div><h2>{{selected.id}} · {{selected.label}}</h2><p class="hint">{{peakModelInfo(selected.model)?.label??selected.model}} · 详细求解结果</p></div><button autofocus aria-label="关闭峰结果详情" data-test="peak-detail-close" @click="close()">关闭</button></header>
      <div class="parameter-dialog-body">
        <p v-if="stale" class="xps-warning">结果已过期；请重新拟合。</p>
        <div class="compact-result-table" tabindex="0" aria-label="参数与标准误"><table><thead><tr><th>参数</th><th>值 ± 标准误</th><th>状态</th></tr></thead><tbody>
          <tr v-for="(p,name) in selected.parameters" :key="name"><th>{{PARAMETER_LABELS[name as PeakParameterName]??name}}</th><td>{{number(p.value)}} ± {{number(p.standard_error)}}<small v-if="'confidence_interval' in p">95% CI {{p.confidence_interval?`${number(p.confidence_interval[0])} — ${number(p.confidence_interval[1])}`:'—'}}</small><small v-if="p.uncertainty_reason">{{p.uncertainty_reason}}</small></td><td>{{p.linked_to?`绑定 ${p.linked_to}`:p.fixed?'固定':'自由'}}<span v-if="p.bound" class="result-warning-tag">贴边</span></td></tr>
        </tbody></table></div>
        <PeakGeometryPanel v-if="selected.geometry" :geometry="selected.geometry" :unit="unit" />
        <p v-else class="hint">连续峰性质未计算，峰顶位置和整体 FWHM 为 —，请重新拟合。</p>
        <p class="hint">全域面积 {{number(selected.areaTotal)}} · 区间面积 {{number(selected.areaWindow)}}（Y × {{unit}}）。派生峰性质未计算标准误。</p>
      </div>
      <footer class="parameter-dialog-footer"><p class="hint">只读结果 · 按 Esc 关闭并返回原位置</p><button @click="close()">返回结果总览</button></footer>
    </div>
  </dialog>
</template>
