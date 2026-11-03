<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
import PeakGeometryPanel from './PeakGeometryPanel.vue';
import { PARAMETER_LABELS, peakModelInfo, type PeakParameterName } from '../peakModels';
import { formatResultNumber as number, type PresentedPeak } from '../resultPresentation';
defineProps<{yUnit?:string;unit:string;stale?:boolean}>();
const emit=defineEmits<{close:[]}>();
const dialog=ref<HTMLDialogElement|null>(null),selected=ref<PresentedPeak|null>(null);
const workspace=ref<HTMLElement|null>(null);
let trigger:HTMLElement|null=null;
// 窄屏切换工作区面板时，原生弹窗仍需独立于隐藏的结果栏。
onMounted(()=>{workspace.value=dialog.value?.closest<HTMLElement>('.analysis-workbench')??null;});
async function open(peak:PresentedPeak,event:Event){
  trigger=event.currentTarget as HTMLElement;selected.value=peak;
  await nextTick();if(selected.value&&!dialog.value?.open)dialog.value?.showModal();
}
function close(restoreFocus=true){
  if(!selected.value&&!dialog.value?.open)return;
  const previous=trigger;trigger=null;selected.value=null;
  if(dialog.value?.open)dialog.value.close();
  if(restoreFocus&&previous?.isConnected){
    previous.focus({preventScroll:true});
    if(document.activeElement!==previous){
      workspace.value?.querySelector<HTMLElement>('.workbench-view-nav [aria-controls="analysis-results"]')?.focus({preventScroll:true});
    }
  }
  emit('close');
}
function afterNativeClose(){if(!dialog.value?.open)close();}
onDeactivated(()=>close(false));onBeforeUnmount(()=>close(false));
defineExpose({open,close});
</script>
<template>
  <Teleport :to="workspace??'body'" :disabled="!workspace">
  <dialog ref="dialog" class="parameter-dialog peak-result-dialog" data-test="peak-result-dialog" :aria-label="selected?`${selected.id} · ${selected.label} 详细求解结果`:'峰详细求解结果'" @cancel.prevent="close()" @close="afterNativeClose">
    <div v-if="selected" class="peak-detail-content" data-test="peak-detail">
      <header class="parameter-dialog-header"><div><h2>{{selected.id}} · {{selected.label}}</h2><p class="hint">{{peakModelInfo(selected.model)?.label??selected.model}} · 详细求解结果</p></div><button autofocus aria-label="关闭峰结果详情" data-test="peak-detail-close" @click="close()">关闭</button></header>
      <div class="parameter-dialog-body">
        <p v-if="stale" class="xps-warning">结果已过期；请重新拟合。</p>
        <h3 class="detail-table-heading">拟合参数</h3>
        <table class="peak-detail-values" aria-label="拟合参数与标准误">
          <thead><tr><th scope="col">参数</th><th scope="col">值 ± 标准误</th><th scope="col">状态</th></tr></thead>
          <tbody>
            <tr v-for="(p,name) in selected.parameters" :key="name">
              <th scope="row">{{PARAMETER_LABELS[name as PeakParameterName]??name}}</th>
              <td>{{number(p.value)}} ± {{number(p.standard_error)}}<small v-if="'confidence_interval' in p">95% CI {{p.confidence_interval?`${number(p.confidence_interval[0])} — ${number(p.confidence_interval[1])}`:'—'}}</small><small v-if="p.uncertainty_reason">{{p.uncertainty_reason}}</small></td>
              <td>{{p.linked_to?`绑定 ${p.linked_to}`:p.fixed?'固定':'自由'}} <span v-if="p.bound" class="result-warning-tag">贴边</span></td>
            </tr>
          </tbody>
        </table>
        <PeakGeometryPanel v-if="selected.geometry" :geometry="selected.geometry" :unit="unit" :y-unit="yUnit" />
        <p v-else class="hint">连续峰性质未计算，峰顶位置和整体 FWHM 为 —，请重新拟合。</p>
        <p class="hint">全域面积 {{number(selected.areaTotal)}} · 区间面积 {{number(selected.areaWindow)}}（{{yUnit??'Y'}} × {{unit}}）。</p>
      </div>
      <footer class="parameter-dialog-footer"><p class="hint">只读结果 · 按 Esc 关闭</p><button @click="close()">返回峰列表</button></footer>
    </div>
  </dialog>
  </Teleport>
</template>

<style scoped>
.peak-result-dialog{width:min(780px,calc(100vw - 24px))}
.peak-detail-content .parameter-dialog-body{min-width:0}
.peak-detail-content .detail-table-heading,.peak-detail-content :deep(.geometry-panel h4){font-size:14px;line-height:1.5;margin:0 0 8px}
.peak-detail-content :deep(.geometry-panel){padding:0;border:0;border-radius:0;background:transparent;overflow:visible;margin:20px 0 10px}
.peak-detail-content :deep(table){width:100%;min-width:0;margin:0;border-collapse:collapse;table-layout:fixed;font-variant-numeric:tabular-nums}
.peak-detail-content :deep(th),.peak-detail-content :deep(td){text-align:left;vertical-align:top;padding:7px 10px;white-space:normal;overflow-wrap:anywhere;border-bottom:1px solid var(--ui-border)}
.peak-detail-content :deep(thead th){color:var(--ui-text-muted);background:var(--ui-subtle);font-size:12px;font-weight:600}
.peak-detail-content :deep(th:first-child){width:35%}
.peak-detail-content :deep(th:nth-child(2)),.peak-detail-content :deep(td:nth-child(2)){width:39%;text-align:right}
.peak-detail-content :deep(th:last-child),.peak-detail-content :deep(td:last-child){width:26%;text-align:left}
.peak-detail-content :deep(.geometry-panel th:nth-child(2)),.peak-detail-content :deep(.geometry-panel td:nth-child(2)){white-space:normal;overflow-wrap:anywhere}
.peak-detail-values small{display:block;margin-top:3px;font-size:12px;color:var(--ui-text-muted)}
@media(max-width:600px){
  .peak-detail-content :deep(th),.peak-detail-content :deep(td){padding:6px;font-size:12px}
  .peak-detail-content :deep(th:first-child){width:32%}
  .peak-detail-content :deep(th:nth-child(2)),.peak-detail-content :deep(td:nth-child(2)){width:41%}
  .peak-detail-content :deep(th:last-child),.peak-detail-content :deep(td:last-child){width:27%}
}
</style>
