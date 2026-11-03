<script setup lang="ts">
import { computed,ref } from 'vue';
import type {RowStatus} from '../batchTypes';
const props=defineProps<{selectedLabel:string;count:number;calculated:number;running:boolean;trendLabel:string;hasPeak:boolean;statuses:RowStatus[];selectedStatus?:RowStatus;message:string;error:string}>();
const emit=defineEmits<{fit:[scope:'current'|'all',kind:'parameters'|'curves'|'configuration'];trend:[];showTrend:[];inspect:[status:'review'|'failed',scope:'current'|'all'];clearFeedback:[]}>();
const scope=ref<'current'|'all'>('current');
const kind=ref<'parameters'|'curves'|'configuration'>('parameters');
const statusLabels:Record<RowStatus,string>={success:'已完成计算',review:'待复核',failed:'失败',pending:'待执行',running:'运行中',skipped:'已跳过'};
const statusCounts=computed(()=>{
  const statuses=scope.value==='all'?props.statuses:props.selectedStatus?[props.selectedStatus]:[];
  return (Object.keys(statusLabels) as RowStatus[]).map(status=>({status,label:statusLabels[status],count:statuses.filter(value=>value===status).length})).filter(item=>item.count);
});
const countStatus=(status:RowStatus)=>statusCounts.value.find(item=>item.status===status)?.count??0;
</script>
<template>
  <section class="panel batch-export-panel" data-test="batch-export-panel" aria-label="导出结果">
    <h3>导出结果</h3>
    <p class="hint">已计算 {{calculated}} / {{count}} 条 · {{running?'批次正在运行，导出截至点击时的快照。':'导出已有结果，不重新拟合。'}}</p>
    <div class="batch-export-row">
      <div><h4>拟合结果</h4><p class="hint">{{scope==='current'?selectedLabel:`整个批次 · ${count} 条谱线`}}</p><p class="hint">保留历史尝试、诊断与人工复核状态，失效结果保留标记。</p>
        <div class="export-status-summary" role="group" data-test="export-status-summary" aria-label="导出范围内的状态"><span v-for="item in statusCounts" :key="item.status" :class="{'needs-review':item.status==='review'||item.status==='failed'}">{{item.label}} {{item.count}}</span></div>
        <p v-if="countStatus('pending')||countStatus('running')" class="hint">尚未完成的谱线仅包含已有记录，导出不会等待计算完成。</p>
        <div v-if="countStatus('review')||countStatus('failed')" class="export-review-actions">
          <button v-if="countStatus('review')" data-test="export-review" @click="emit('inspect','review',scope)">查看待复核结果（{{countStatus('review')}}）</button>
          <button v-if="countStatus('failed')" data-test="export-failed" @click="emit('inspect','failed',scope)">查看失败谱线（{{countStatus('failed')}}）</button>
        </div>
      </div>
      <div class="batch-export-controls">
        <label>导出范围<select v-model="scope" aria-label="拟合结果导出范围" @change="emit('clearFeedback')"><option value="current">当前谱线</option><option value="all">整个批次</option></select></label>
        <label>导出内容<select v-model="kind" aria-label="拟合结果导出内容" @change="emit('clearFeedback')"><option value="parameters">参数 CSV</option><option value="curves">曲线 CSV</option><option value="configuration">追溯 JSON</option></select></label>
        <button class="primary" :disabled="!count" @click="emit('fit',scope,kind)" data-test="export-fit">导出拟合结果</button>
      </div>
    </div>
    <div class="batch-export-row">
      <div><h4>趋势数据</h4><p class="hint">{{trendLabel}} · 全部 {{count}} 条谱线</p><p class="hint">缺失数值留空，保留失败、跳过和待复核状态。</p><p v-if="!hasPeak" class="hint">暂无可选峰，请先检查拟合模板。</p></div>
      <div class="xps-actions"><button @click="emit('showTrend')">调整趋势选择</button><button class="primary" :disabled="!hasPeak||!count" @click="emit('trend')" data-test="export-trend">导出趋势数据 CSV</button></div>
    </div>
    <p v-if="error" class="error" role="alert">{{error}}</p>
    <p v-else-if="message" role="status">{{message}}</p>
  </section>
</template>
<style scoped>
.export-status-summary{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;font-size:13px;font-variant-numeric:tabular-nums}
.export-status-summary span{padding:4px 8px;border:1px solid var(--ui-border);border-radius:4px;background:var(--ui-subtle)}
.export-status-summary .needs-review{border-color:#d8b374;background:#fff4dc;color:#744208}
.export-review-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.batch-export-panel h3,.batch-export-panel h4{margin:0}.batch-export-panel h4{font-size:15px}
.batch-export-row{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:20px 0;border-top:1px solid var(--ui-border)}
.batch-export-row>div{min-width:0}.batch-export-row p{overflow-wrap:anywhere;margin:6px 0 0}
.batch-export-controls{display:flex;align-items:end;gap:10px;flex-wrap:wrap}.batch-export-controls label{margin:0;display:grid;gap:6px;min-width:130px}.batch-export-controls select{width:100%}
.batch-export-row .xps-actions{flex-shrink:0}
@media(max-width:900px){.batch-export-row{align-items:stretch;flex-direction:column}.batch-export-controls{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.batch-export-controls label{min-width:0}.batch-export-controls>button{grid-column:1/-1}}
</style>
