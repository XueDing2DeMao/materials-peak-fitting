<script setup lang="ts">
import {ref} from 'vue';
import {analysisReport,type ReportEntry} from '../analysisReport';
import {saveFile} from '../resultExport';
const props=defineProps<{entries:ReportEntry[];disabled?:boolean}>();
const note=ref(''),error=ref('');
function download(){if(props.disabled||!props.entries.length)return;try{saveFile('analysis-report.html',analysisReport(props.entries,note.value),'text/html;charset=utf-8');error.value='';}catch(e){error.value=`摘要生成失败：${String(e)}`;}}
</script>
<template><details class="panel analysis-report-actions"><summary>分析摘要 · 可打印 HTML</summary><p class="hint">使用已保存结果，不重新拟合；保留警告、来源与过期标记。浏览器打开后可打印或另存 PDF。</p><label>用户备注（与软件计算值分开）<textarea v-model="note" maxlength="5000" rows="3" /></label><button :disabled="disabled||!entries.length" @click="download">导出分析摘要 HTML</button><p v-if="error" class="error" role="alert">{{error}}</p></details></template>
<style scoped>.analysis-report-actions{margin-top:16px;min-width:0}.analysis-report-actions textarea{width:100%;resize:vertical}</style>
