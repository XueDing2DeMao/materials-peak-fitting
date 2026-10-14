<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import type { DatasetInfo } from "../types";
import DatasetTable from './DatasetTable.vue';
import {loadDatasetRows} from '../api';

const props = defineProps<{ dataset: DatasetInfo | null; appliedDataset?:DatasetInfo|null; analysisMode?:'single'|'xrd'|'xps'; loading: boolean; previewLoading?: boolean; error?: string; appliedSelection?: { sheet: string; xColumn: string; yColumn: string } | null; snapshot?:{x:number[];y:number[]}; pointCount?: number }>();
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
let trigger:HTMLElement|null=null;
const isSnapshot=computed(()=>props.dataset?.dataset_id.startsWith('session:'));
function remember(event?:Event){if(event?.currentTarget instanceof HTMLElement)trigger=event.currentTarget;}
async function showPicker(event?:Event){remember(event);pickerOpen.value=true;await nextTick();if(pickerOpen.value&&picker.value&&!picker.value.open)picker.value.showModal();}
function closePicker(restoreFocus=true){const wasOpen=pickerOpen.value||picker.value?.open;pickerOpen.value=false;if(picker.value?.open)picker.value.close();if(restoreFocus&&wasOpen)void nextTick(()=>{(trigger?.isConnected?trigger:sourceAction.value)?.focus({preventScroll:true});});}
watch(pickerOpen,async open=>{await nextTick();if(open&&pickerOpen.value&&picker.value&&!picker.value.open)picker.value.showModal();else if(!open&&picker.value?.open)picker.value.close();});
onBeforeUnmount(()=>closePicker(false));
const unitHint=computed(()=>props.analysisMode==='xrd'?'X 列须为 2θ（°）':props.analysisMode==='xps'?'X 列须为结合能（eV）':'X 列保留原数据单位，请核对坐标含义');
const busy = computed(() => props.loading || props.previewLoading);

function applyDefaultSelection(dataset = props.dataset): void {
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
        <div class="dataset-file"><span class="dataset-file-mark" aria-hidden="true">▦</span><div><strong>{{ (appliedDataset??dataset).filename }}</strong><small v-if="appliedSelection">{{ (pointCount ?? 0).toLocaleString() }} 个有效点 · {{ appliedSelection.sheet }} <template v-if="(appliedDataset??dataset).dataset_id.startsWith('session:')"> · 会话原谱快照</template><template v-else> · 工作表 {{ appliedSheet?.row_count.toLocaleString() }} 行</template></small><small v-else>未应用数据列</small></div></div>
        <button class="quiet-button" type="button" :disabled="loading" @click="openFilePicker">{{ loading ? '正在读取…' : '更换数据' }}</button>
      </div>
      <div class="dataset-columns">
        <span><b>X</b>{{ appliedSelection?.xColumn || "—" }}</span><span><b>Y</b>{{ appliedSelection?.yColumn || "—" }}</span>
        <button ref="sourceAction" data-test="open-selection" :disabled="busy" @click="showPicker">{{isSnapshot?'查看会话原谱':'查看全部数据 / 更改列'}}</button>
      </div>

    </template>
    <p v-if="error&&!pickerOpen" class="dataset-error" role="alert">{{ error }}</p>
    <dialog ref="picker" class="parameter-dialog dataset-import-dialog" aria-label="数据导入与完整预览" @cancel.prevent="cancelSelection" @close="pickerOpen=false">
      <header class="parameter-dialog-header"><div><h2>{{isSnapshot?'查看会话原谱':'导入与核对数据'}}</h2><p class="hint">{{dataset?.filename}} · {{isSnapshot?'已保存的谱列，只读浏览':'先核对工作表与数据列，再应用到图表'}}</p></div><button aria-label="关闭数据导入弹窗" :disabled="busy" @click="cancelSelection">关闭</button></header>
      <div v-if="dataset" class="parameter-dialog-body">
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
      <footer class="parameter-dialog-footer"><p class="hint">{{isSnapshot?'仅包含已保存的谱列；其他数据请重新导入原文件。':'浏览与翻页不会替换当前谱线。'}}</p><div class="xps-actions"><button data-test="cancel-selection" :disabled="busy" @click="cancelSelection">{{isSnapshot?'关闭':'取消'}}</button><button v-if="!isSnapshot" data-test="apply-selection" class="primary" :disabled="busy||!xColumn||!yColumn||xColumn===yColumn" @click="applySelection">{{previewLoading?'正在应用…':'应用到图表'}}</button></div></footer>
    </dialog>
  </section>
</template>
