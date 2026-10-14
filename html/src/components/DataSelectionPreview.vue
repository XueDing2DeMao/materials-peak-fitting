<script setup lang="ts">
import type { SheetInfo } from '../types';
defineProps<{sheet:SheetInfo|null;xColumn:string;yColumn:string}>();
</script>
<template>
  <div v-if="sheet" class="data-selection-preview">
    <p class="hint">工作表前 {{Math.min(5,sheet.preview_rows.length)}} 行 · 请核对原谱、统计值和误差列的角色。</p>
    <div class="data-preview-scroll" tabindex="0" role="region" aria-label="工作表原始行预览">
      <table><thead><tr><th v-for="column in sheet.columns" :key="column">{{column}}<small v-if="column===xColumn">建议 X</small><small v-if="column===yColumn">建议 Y</small></th></tr></thead>
        <tbody><tr v-for="(row,index) in sheet.preview_rows.slice(0,5)" :key="index"><td v-for="column in sheet.columns" :key="column">{{row[column]??'—'}}</td></tr></tbody>
      </table>
    </div>
    <p v-if="!sheet.preview_rows.length" class="hint">此工作表未提供行预览，请核对原文件中的列含义。</p>
  </div>
</template>
<style scoped>
.data-selection-preview{grid-column:1 / -1;min-width:0}.data-preview-scroll{max-width:100%;overflow:auto;max-height:240px}.data-preview-scroll table{width:max-content;min-width:100%;margin:0}.data-preview-scroll th,.data-preview-scroll td{white-space:nowrap;padding:6px 10px}.data-preview-scroll small{display:block}
</style>
