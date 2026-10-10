<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { DatasetInfo } from "../types";

const props = defineProps<{ dataset: DatasetInfo | null; loading: boolean; error?: string }>();
const emit = defineEmits<{ upload: [file: File]; preview: [selection: { sheet: string; xColumn: string; yColumn: string }] }>();
const sheetName = ref(""); const xColumn = ref(""); const yColumn = ref("");
const sheet = computed(() => props.dataset?.sheets.find((item) => item.name === sheetName.value) ?? null);
const previewRows = computed(() => sheet.value?.preview_rows ?? []);
const previewColumns = computed(() => sheet.value?.columns ?? []);

watch(() => props.dataset, (dataset) => {
  const first = dataset?.sheets.find((item) => item.numeric_columns.length >= 2);
  sheetName.value = first?.name ?? ""; xColumn.value = first?.numeric_columns[0] ?? ""; yColumn.value = first?.numeric_columns[1] ?? "";
  if (first && xColumn.value && yColumn.value) emit("preview", { sheet: first.name, xColumn: xColumn.value, yColumn: yColumn.value });
}, { immediate: true });
watch(sheetName, () => {
  const columns = sheet.value?.numeric_columns ?? [];
  xColumn.value = columns[0] ?? ""; yColumn.value = columns[1] ?? "";
});
function chooseFile(event: Event): void { const file = (event.target as HTMLInputElement).files?.[0]; if (file) emit("upload", file); }
function selectColumns(): void { if (sheetName.value && xColumn.value && yColumn.value) emit("preview", { sheet: sheetName.value, xColumn: xColumn.value, yColumn: yColumn.value }); }
</script>

<template>
  <section class="panel">
    <div class="panel-title"><span class="step-number">1</span><div><h2>导入数据</h2><p>表格与文本数据仅在本机解析。</p></div></div>
    <label class="file-input"><span>选择本地文件</span><small>CSV、TXT、TSV、DAT、XY、XYE、XLS、XLSX 或 XLSM</small><input type="file" accept=".csv,.txt,.tsv,.dat,.xy,.xye,.xls,.xlsx,.xlsm" :disabled="loading" @change="chooseFile" /></label>
    <p v-if="loading" class="hint">正在读取文件…</p><p v-if="error" class="error">{{ error }}</p>
    <template v-if="dataset">
      <p class="filename">{{ dataset.filename }}</p>
      <p data-test="column-selection-hint" class="column-selection-hint"><strong>选择拟合列</strong><span>默认使用前两列数值数据；可在 X、Y 下拉框中选择其他数值列作为当前拟合曲线。</span></p>
      <label>工作表<select v-model="sheetName"><option v-for="item in dataset.sheets" :key="item.name" :value="item.name">{{ item.name }}（{{ item.row_count }} 行）</option></select></label>
      <label>X 列<select v-model="xColumn" data-test="x-column"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
      <label>Y 列<select v-model="yColumn" data-test="y-column"><option v-for="column in sheet?.numeric_columns" :key="column" :value="column">{{ column }}</option></select></label>
      <button data-test="preview-data" type="button" :disabled="xColumn === yColumn" @click="selectColumns">显示数据</button>
      <p v-if="xColumn === yColumn" class="fit-blocker" role="status">X 列与 Y 列不能相同，请选择两列不同的数值数据。</p>
      <details v-if="previewRows.length" class="data-preview" open><summary>前 {{ previewRows.length }} 行预览</summary><div class="preview-scroll"><table><thead><tr><th v-for="column in previewColumns" :key="column">{{ column }}</th></tr></thead><tbody><tr v-for="(row, index) in previewRows" :key="index"><td v-for="column in previewColumns" :key="column">{{ row[column] ?? "—" }}</td></tr></tbody></table></div></details>
    </template>
  </section>
</template>
