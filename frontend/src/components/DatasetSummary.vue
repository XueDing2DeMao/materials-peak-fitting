<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DatasetInfo } from "../types";

const props = defineProps<{ dataset: DatasetInfo | null; loading: boolean; error?: string }>();
const emit = defineEmits<{
  upload: [file: File];
  preview: [selection: { sheet: string; xColumn: string; yColumn: string }];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const sheetName = ref("");
const xColumn = ref("");
const yColumn = ref("");
const sheet = computed(() => props.dataset?.sheets.find((item) => item.name === sheetName.value) ?? null);
const selectedPointCount = computed(() => sheet.value?.row_count ?? 0);

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
});

function chooseFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (file) emit("upload", file);
}

function openFilePicker(): void {
  fileInput.value?.click();
}

function applySelection(): void {
  if (sheetName.value && xColumn.value && yColumn.value && xColumn.value !== yColumn.value) {
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
      <p v-if="error" class="dataset-error">{{ error }}</p>
    </template>

    <template v-else>
      <div class="dataset-summary-row">
        <div class="dataset-file"><span class="dataset-file-mark" aria-hidden="true">▦</span><div><strong>{{ dataset.filename }}</strong><small>{{ selectedPointCount.toLocaleString() }} 个数据点 · {{ sheetName || "未选择工作表" }}</small></div></div>
        <button class="quiet-button" type="button" :disabled="loading" @click="openFilePicker">更换数据</button>
      </div>
      <div class="dataset-columns">
        <span><b>X</b>{{ xColumn || "—" }}</span><span><b>Y</b>{{ yColumn || "—" }}</span>
        <details>
          <summary>更改列</summary>
          <div class="column-picker">
            <label>工作表<select v-model="sheetName"><option v-for="item in dataset.sheets" :key="item.name" :value="item.name">{{ item.name }}（{{ item.row_count }} 行）</option></select></label>
            <label>X 列<select v-model="xColumn"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
            <label>Y 列<select v-model="yColumn"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
            <button type="button" :disabled="xColumn === yColumn" @click="applySelection">应用到图表</button>
          </div>
        </details>
      </div>
      <p v-if="xColumn === yColumn" class="dataset-error">X 列与 Y 列不能相同，请选择两列不同的数值数据。</p>
    </template>
  </section>
</template>
