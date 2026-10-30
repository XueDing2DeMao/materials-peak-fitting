<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import type { DatasetInfo } from "../types";
import DatasetTable from './DatasetTable.vue';
import DatasetAuditSummary from './DatasetAuditSummary.vue';
import type { DatasetAudit } from '../datasetAudit';
import {loadDatasetRows} from '../api';

const props = defineProps<{ dataset: DatasetInfo | null; appliedDataset?:DatasetInfo|null; analysisMode?:'single'|'xrd'|'xps'; loading: boolean; previewLoading?: boolean; error?: string; appliedSelection?: { sheet: string; xColumn: string; yColumn: string } | null; snapshot?:{x:number[];y:number[]}; pointCount?: number; audit?:DatasetAudit|null }>();
const emit = defineEmits<{
  upload: [file: File];
  preview: [selection: { sheet: string; xColumn: string; yColumn: string }];
  cancel: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const sourceAction=ref<HTMLButtonElement|null>(null);
const sheetName = ref("");
const xColumn = ref("");
const yColumn = ref("");
const sheet = computed(() => props.dataset?.sheets.find((item) => item.name === sheetName.value) ?? null);
const picker = ref<HTMLDialogElement | null>(null);
const appliedSheet = computed(() => (props.appliedDataset??props.dataset)?.sheets.find(item => item.name === props.appliedSelection?.sheet));
const pendingFile=computed(()=>props.appliedDataset?.dataset_id!==props.dataset?.dataset_id);
const pending = computed(() => pendingFile.value || sheetName.value !== props.appliedSelection?.sheet || xColumn.value !== props.appliedSelection?.xColumn || yColumn.value !== props.appliedSelection?.yColumn);
const pickerOpen=ref(false);
const detailTab=ref<'data'|'audit'>('data'),detailId=useId();
const detailTabs=ref<HTMLButtonElement[]>([]);
const detailViews=[{id:'data',label:'原始数据与列选择'},{id:'audit',label:'清理记录'}] as const;
const auditAttention=computed(()=>Boolean(props.audit&&(props.audit.excluded_pairs||props.audit.duplicate_x_count)));
const auditReadout=computed(()=>props.audit?`有效 ${props.audit.valid_pairs.toLocaleString()} 点 · 排除 ${props.audit.excluded_pairs} 行${props.audit.duplicate_x_count?` · 重复 X ${props.audit.duplicate_x_count} 个`:''}`:`有效 ${(props.pointCount??0).toLocaleString()} 点 · 清理记录未提供`);
async function navigateDetails(event:KeyboardEvent,index:number){
  const target=event.key==='Home'?0:event.key==='End'?1:['ArrowRight','ArrowLeft'].includes(event.key)?1-index:null;
  if(target===null)return;
  event.preventDefault();
  if(target===1&&!props.appliedSelection)return;
  detailTab.value=detailViews[target].id;await nextTick();detailTabs.value[target]?.focus();
}
let trigger:HTMLElement|null=null;
const isSnapshot=computed(()=>props.dataset?.dataset_id.startsWith('session:'));
function remember(event?:Event){if(event?.currentTarget instanceof HTMLElement)trigger=event.currentTarget;}
async function showPicker(event?:Event,tab:'data'|'audit'='data'){remember(event);detailTab.value=tab;pickerOpen.value=true;await nextTick();if(pickerOpen.value&&picker.value&&!picker.value.open)picker.value.showModal();}
function closePicker(restoreFocus=true){const wasOpen=pickerOpen.value||picker.value?.open;pickerOpen.value=false;if(picker.value?.open)picker.value.close();if(restoreFocus&&wasOpen)void nextTick(()=>{(trigger?.isConnected?trigger:sourceAction.value)?.focus({preventScroll:true});});}
watch(pickerOpen,async open=>{await nextTick();if(open&&pickerOpen.value&&picker.value&&!picker.value.open)picker.value.showModal();else if(!open&&picker.value?.open)picker.value.close();});
onBeforeUnmount(()=>closePicker(false));
const unitHint=computed(()=>props.analysisMode==='xrd'?'X 列须为 2θ（°）':props.analysisMode==='xps'?'X 列须为结合能（eV）':'X 列保留原数据单位，请核对坐标含义');
const busy = computed(() => props.loading || props.previewLoading);

function applyDefaultSelection(dataset = props.dataset): void {
  detailTab.value='data';
  if(dataset&&dataset.dataset_id===props.appliedDataset?.dataset_id&&props.appliedSelection){
    sheetName.value=props.appliedSelection.sheet;xColumn.value=props.appliedSelection.xColumn;yColumn.value=props.appliedSelection.yColumn;
    closePicker();return;
  }
  const first = dataset?.sheets.find((item) => item.numeric_columns.length >= 2);
  sheetName.value = first?.name ?? dataset?.sheets[0]?.name ?? "";
  xColumn.value = first?.numeric_columns[0] ?? "";
  yColumn.value = first?.numeric_columns[1] ?? "";
  pickerOpen.value=Boolean(dataset);

}

watch(() => props.dataset, applyDefaultSelection, { immediate: true });
watch(sheetName, () => {
  const columns = sheet.value?.numeric_columns ?? [];
  if (!columns.includes(xColumn.value)) xColumn.value = columns[0] ?? "";
  if (!columns.includes(yColumn.value) || yColumn.value === xColumn.value) yColumn.value = columns.find((column) => column !== xColumn.value) ?? "";
}, { flush: "sync" });
function resetDraft(): void {
  if (props.appliedSelection && !pendingFile.value) {
    sheetName.value = props.appliedSelection.sheet;
    xColumn.value = props.appliedSelection.xColumn;
    yColumn.value = props.appliedSelection.yColumn;
  }
}
watch(() => props.appliedSelection, () => {
  resetDraft();
  closePicker();
});
function cancelSelection(): void {if(busy.value)return;emit('cancel');resetDraft();closePicker();}

function chooseFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("upload", file);
  (event.target as HTMLInputElement).value = "";
}

function openFilePicker(event?:Event): void {
  remember(event);fileInput.value?.click();
}

function applySelection(): void {
  if (!busy.value && sheetName.value && xColumn.value && yColumn.value && xColumn.value !== yColumn.value) {
    emit("preview", { sheet: sheetName.value, xColumn: xColumn.value, yColumn: yColumn.value });
  }
}
</script>

<template>
  <section class="dataset-summary" aria-label="数据集">
    <input ref="fileInput" hidden type="file" accept=".csv,.txt,.tsv,.dat,.xy,.xye,.xls,.xlsx,.xlsm" :disabled="loading" @change="chooseFile" />
    <template v-if="!dataset">
      <button ref="sourceAction" data-test="import-dropzone" class="import-dropzone" type="button" :disabled="loading" @click="openFilePicker">
        <span class="import-icon" aria-hidden="true">↥</span>
        <span><strong>{{ loading ? "正在读取数据…" : "导入实验数据" }}</strong><small>CSV · TXT · TSV · DAT · XY · XYE · XLS · XLSX · XLSM</small></span>
      </button>
    </template>

    <template v-else>
      <div class="dataset-summary-row">
        <div class="dataset-file"><span class="dataset-file-mark" aria-hidden="true">▦</span><div><strong>{{ (appliedDataset??dataset).filename }}</strong><small v-if="appliedSelection">{{ appliedSelection.sheet }} <template v-if="(appliedDataset??dataset).dataset_id.startsWith('session:')"> · 会话原谱快照</template><template v-else> · 工作表 {{ appliedSheet?.row_count.toLocaleString() }} 行</template></small><small v-else>未应用数据列</small><button v-if="appliedSelection" data-test="open-audit" class="dataset-audit-link" :class="{'needs-attention':auditAttention}" :disabled="busy" type="button" title="查看当前谱线的清理记录" @click="showPicker($event,'audit')">{{auditReadout}}</button></div></div>
        <div class="dataset-actions"><button class="quiet-button" type="button" :disabled="loading" @click="openFilePicker">{{ loading ? '正在读取…' : '更换数据' }}</button><button ref="sourceAction" data-test="open-selection" :disabled="busy" type="button" @click="showPicker">数据详情</button></div>
      </div>
      <div class="dataset-columns">
        <span><b>X</b>{{ appliedSelection?.xColumn || "—" }}</span><span><b>Y</b>{{ appliedSelection?.yColumn || "—" }}</span>
      </div>

    </template>
    <p v-if="error&&!pickerOpen" class="dataset-error" role="alert">{{ error }}</p>
    <dialog ref="picker" class="parameter-dialog dataset-import-dialog" aria-label="数据导入与完整预览" @cancel.prevent="cancelSelection" @close="pickerOpen=false">
      <header class="parameter-dialog-header"><div><h2>数据详情</h2><p class="hint">{{detailTab==='audit'?(appliedDataset??dataset)?.filename:dataset?.filename}} · {{detailTab==='audit'?'当前已应用谱线的清理记录':isSnapshot?'已保存的谱列，只读浏览':'先核对工作表与数据列，再应用到图表'}}</p></div><button aria-label="关闭数据导入弹窗" :disabled="busy" @click="cancelSelection">关闭</button></header>
      <div class="dataset-detail-tabs" role="tablist" aria-label="数据详情视图"><button v-for="(view,index) in detailViews" :key="view.id" ref="detailTabs" type="button" role="tab" :id="`${detailId}-${view.id}`" :aria-controls="`${detailId}-${view.id}-panel`" :aria-selected="detailTab===view.id" :tabindex="detailTab===view.id?0:-1" :disabled="view.id==='audit'&&!appliedSelection" :data-test="`dataset-tab-${view.id}`" @click="detailTab=view.id" @keydown="navigateDetails($event,index)">{{view.label}}</button></div>
      <div v-if="dataset" class="parameter-dialog-body">
        <div v-show="detailTab==='data'" :id="`${detailId}-data-panel`" role="tabpanel" :aria-labelledby="`${detailId}-data`">
        <div class="import-column-fields">
          <label>工作表<select v-model="sheetName" :disabled="busy||isSnapshot"><option v-for="item in dataset.sheets" :key="item.name" :value="item.name">{{item.name}}（{{item.row_count}} 行）</option></select></label>
          <label>X 列<select v-model="xColumn" :disabled="busy||isSnapshot"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{column}}</option></select></label>
          <label>Y 列<select v-model="yColumn" :disabled="busy||isSnapshot"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{column}}</option></select></label>
        </div>
        <p class="hint">{{unitHint}}；切换分析类型不会转换数据或单位。</p>
        <p v-if="pending&&!isSnapshot" class="selection-pending" role="status">{{pendingFile?`待应用文件：${dataset.filename}。`:''}}建议选择待应用；当前图表保持原数据。</p>
        <p v-if="!sheet||sheet.numeric_columns.length<2" class="dataset-error">没有可用的 X/Y 数值列组合，请选择其他工作表或文件。</p>
        <p v-if="xColumn&&xColumn===yColumn" class="dataset-error">X/Y 须选择不同的数值列。</p>
        <p v-if="error" class="dataset-error" role="alert">{{error}}</p>
        <DatasetTable v-if="pickerOpen" :dataset-id="dataset.dataset_id" :sheet="sheet" :x-column="xColumn" :y-column="yColumn" :snapshot="snapshot" :load="loadDatasetRows" />
        </div>
        <div v-show="detailTab==='audit'" :id="`${detailId}-audit-panel`" role="tabpanel" :aria-labelledby="`${detailId}-audit`">
          <p class="hint">当前谱线：{{appliedSelection?.sheet}} · X {{appliedSelection?.xColumn}} · Y {{appliedSelection?.yColumn}}</p>
          <DatasetAuditSummary :audit="audit" expanded />
        </div>
      </div>
      <footer class="parameter-dialog-footer"><p class="hint">{{detailTab==='audit'?'清理记录对应当前图表；切换标签不会应用列选择。':isSnapshot?'仅包含已保存的谱列；其他数据请重新导入原文件。':'浏览与翻页不会替换当前谱线。'}}</p><div class="xps-actions"><button data-test="cancel-selection" :disabled="busy" @click="cancelSelection">{{isSnapshot||detailTab==='audit'?'关闭':'取消'}}</button><button v-if="!isSnapshot" v-show="detailTab==='data'" data-test="apply-selection" class="primary" :disabled="busy||!xColumn||!yColumn||xColumn===yColumn" @click="applySelection">{{previewLoading?'正在应用…':'应用到图表'}}</button></div></footer>
    </dialog>
  </section>
</template>
<style scoped>
.dataset-actions{display:flex;gap:8px;flex:none;align-items:center}
.dataset-audit-link{display:block;border:0;background:transparent;padding:0;min-height:24px;height:auto;font-size:12px;color:var(--ui-primary);text-align:left;white-space:normal}
.dataset-audit-link:hover{text-decoration:underline}
.dataset-audit-link.needs-attention{color:#925400;font-weight:600}
.dataset-detail-tabs{display:flex;flex:none;gap:6px;padding:8px 20px;border-bottom:1px solid var(--ui-border)}
.dataset-detail-tabs button{background:transparent;border-color:transparent}
.dataset-detail-tabs button[aria-selected=true]{background:var(--ui-selected);border-color:var(--ui-border);color:var(--ui-primary);font-weight:600}
.dataset-import-dialog .dataset-audit :deep(.audit-row-list){max-height:none;overflow:visible}
@media(max-width:700px){.dataset-summary-row{flex-wrap:wrap}.dataset-actions{margin-left:auto}.dataset-detail-tabs{padding:6px}}
</style>
