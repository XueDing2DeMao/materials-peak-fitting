<script setup lang="ts">
import {auditSummary,auditReasons,type DatasetAudit} from '../datasetAudit';
defineProps<{audit?:DatasetAudit|null}>();
</script>
<template>
  <div class="dataset-audit"><p class="hint" data-test="dataset-audit-summary">{{auditSummary(audit)}}</p>
    <details v-if="audit"><summary>查看清理与行号记录</summary>
      <p class="hint">行号基于解析后的工作表（不含表头），不是原文件物理行号；汇总以移除全空行后的表为基数。同一行可同时有 X/Y 排除原因，原因次数不一定等于排除行数。重复 X 保留，拟合前仍需检查。</p>
      <ul><li v-for="(count,reason) in audit.exclusion_reasons" :key="reason">{{auditReasons[reason]??reason}}：{{count}}</li></ul>
      <div v-if="audit.excluded_rows.length" class="audit-row-list" tabindex="0" role="region" aria-label="排除行记录"><table><thead><tr><th>解析行号</th><th>原因</th></tr></thead><tbody><tr v-for="r in audit.excluded_rows" :key="r.parsed_row"><td>{{r.parsed_row}}</td><td>{{r.reasons.map(v=>auditReasons[v]??v).join('；')}}</td></tr></tbody></table></div>
      <p v-if="audit.excluded_rows_truncated" class="hint">仅列前 200 条排除记录，汇总计数覆盖全部行。</p>
      <p class="hint">排序后每点的解析行号保存在会话审计记录中；观测值未被插值或修补。</p>
    </details>
  </div>
</template>
<style scoped>.audit-row-list{max-height:240px;overflow:auto;max-width:100%}.dataset-audit{margin-top:8px;min-width:0}</style>
