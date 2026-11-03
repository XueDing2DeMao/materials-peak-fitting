<script setup lang="ts">
import {ref} from 'vue';
import {analysisReport,type ReportEntry} from '../analysisReport';
import {saveFile} from '../resultExport';
import '../styles/analysisArchive.css';
const props=withDefaults(defineProps<{entries:ReportEntry[];disabled?:boolean;title?:string}>(),{title:'分析摘要 · 可打印 HTML'});
const note=ref(''),error=ref('');
function download(){if(props.disabled||!props.entries.length)return;try{saveFile('analysis-report.html',analysisReport(props.entries,note.value),'text/html;charset=utf-8');error.value='';}catch(e){error.value=`摘要生成失败：${String(e)}`;}}
</script>
<template>
  <details class="panel analysis-report-actions">
    <summary>{{title}}</summary>
    <div class="archive-section-body">
      <p class="hint">使用已保存结果，不重新拟合；保留警告、来源与过期标记。用浏览器打开 HTML 后可打印或另存为 PDF。</p>
      <label class="report-note">用户备注（与软件计算值分开）<textarea v-model="note" maxlength="5000" rows="3" /></label>
      <div class="archive-action-row">
        <button type="button" :disabled="disabled||!entries.length" @click="download">导出分析摘要 HTML</button>
        <span v-if="!entries.length" class="hint">暂无可导出的结果。</span>
      </div>
      <p v-if="error" class="error" role="alert">{{error}}</p>
    </div>
  </details>
</template>
