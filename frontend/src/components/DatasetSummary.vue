<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DatasetInfo } from "../types";

const props = defineProps<{ dataset: DatasetInfo | null; loading: boolean; previewLoading?: boolean; error?: string; appliedSelection?: { sheet: string; xColumn: string; yColumn: string } | null; pointCount?: number }>();
const emit = defineEmits<{
  upload: [file: File];
  preview: [selection: { sheet: string; xColumn: string; yColumn: string }];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const sheetName = ref("");
const xColumn = ref("");
const yColumn = ref("");
const sheet = computed(() => props.dataset?.sheets.find((item) => item.name === sheetName.value) ?? null);
const picker = ref<HTMLDetailsElement | null>(null);
const appliedSheet = computed(() => props.dataset?.sheets.find(item => item.name === props.appliedSelection?.sheet));
const pending = computed(() => sheetName.value !== props.appliedSelection?.sheet || xColumn.value !== props.appliedSelection?.xColumn || yColumn.value !== props.appliedSelection?.yColumn);
const busy = computed(() => props.loading || props.previewLoading);

function applyDefaultSelection(dataset = props.dataset): void {
  const first = dataset?.sheets.find((item) => item.numeric_columns.length >= 2);
  sheetName.value = first?.name ?? "";
  xColumn.value = first?.numeric_columns[0] ?? "";
  yColumn.value = first?.numeric_columns[1] ?? "";
  if (first && xColumn.value && yColumn.value) {
    emit("preview", { sheet: first.name, xColumn: xColumn.value, yColumn: yColumn.value });
  }
}

watch(() => props.dataset, applyDefaultSelection, { immediate: true });
watch(sheetName, () => {
  const columns = sheet.value?.numeric_columns ?? [];
  if (!columns.includes(xColumn.value)) xColumn.value = columns[0] ?? "";
  if (!columns.includes(yColumn.value) || yColumn.value === xColumn.value) yColumn.value = columns.find((column) => column !== xColumn.value) ?? "";
}, { flush: "sync" });
function resetDraft(): void {
  if (props.appliedSelection) {
    sheetName.value = props.appliedSelection.sheet;
    xColumn.value = props.appliedSelection.xColumn;
    yColumn.value = props.appliedSelection.yColumn;
  }
}
watch(() => props.appliedSelection, () => {
  resetDraft();
  if (picker.value) picker.value.open = false;
});
function cancelSelection(): void { resetDraft(); if (picker.value) picker.value.open = false; }

function chooseFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("upload", file);
  (event.target as HTMLInputElement).value = "";
}

function openFilePicker(): void {
  fileInput.value?.click();
}

function applySelection(): void {
  if (!busy.value && sheetName.value && xColumn.value && yColumn.value && xColumn.value !== yColumn.value) {
    emit("preview", { sheet: sheetName.value, xColumn: xColumn.value, yColumn: yColumn.value });
  }
}
</script>

<template>
  <section class="dataset-summary" aria-label="数据集">
    <input ref="fileInput" class="sr-only" type="file" accept=".csv,.txt,.tsv,.dat,.xy,.xye,.xls,.xlsx,.xlsm" :disabled="loading" @change="chooseFile" />
    <template v-if="!dataset">
      <button data-test="import-dropzone" class="import-dropzone" type="button" :disabled="loading" @click="openFilePicker">
        <span class="import-icon" aria-hidden="true">↥</span>
        <span><strong>{{ loading ? "正在读取数据…" : "导入实验数据" }}</strong><small>CSV · TXT · TSV · DAT · XY · XYE · XLS · XLSX · XLSM</small></span>
      </button>
    </template>

    <template v-else>
      <div class="dataset-summary-row">
        <div class="dataset-file"><span class="dataset-file-mark" aria-hidden="true">▦</span><div><strong>{{ dataset.filename }}</strong><small v-if="appliedSelection">{{ (pointCount ?? 0).toLocaleString() }} 个有效点 · {{ appliedSelection.sheet }} · 工作表 {{ appliedSheet?.row_count.toLocaleString() }} 行</small><small v-else>未应用数据列</small></div></div>
        <button class="quiet-button" type="button" :disabled="loading" @click="openFilePicker">{{ loading ? '正在读取…' : '更换数据' }}</button>
      </div>
      <div class="dataset-columns">
        <span><b>X</b>{{ appliedSelection?.xColumn || "—" }}</span><span><b>Y</b>{{ appliedSelection?.yColumn || "—" }}</span>
        <details ref="picker">
          <summary>更改列</summary>
          <div class="column-picker">
            <label>工作表<select v-model="sheetName" :disabled="busy"><option v-for="item in dataset.sheets" :key="item.name" :value="item.name">{{ item.name }}（{{ item.row_count }} 行）</option></select></label>
            <label>X 列<select v-model="xColumn" :disabled="busy"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
            <label>Y 列<select v-model="yColumn" :disabled="busy"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
            <p v-if="pending" class="selection-pending" role="status">尚未应用；当前图表保持原数据。</p>
            <div class="column-picker-actions"><button data-test="cancel-selection" type="button" :disabled="busy" @click="cancelSelection">取消</button><button data-test="apply-selection" type="button" class="primary" :disabled="busy || !xColumn || !yColumn || xColumn === yColumn" @click="applySelection">{{ previewLoading ? '正在应用…' : '应用到图表' }}</button></div>
          </div>
        </details>
      </div>
      <p v-if="xColumn === yColumn" class="dataset-error">X/Y 须选择不同的数值列。</p>
    </template>
    <p v-if="error" class="dataset-error" role="alert">{{ error }}</p>
  </section>
</template>
