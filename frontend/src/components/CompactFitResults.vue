<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import PeakResultTable from './PeakResultTable.vue';
import SamplingDiagnostics from './SamplingDiagnostics.vue';
import { presentPeaks } from '../resultPresentation';
import { resultDiagnostics } from '../resultDiagnostics';
import type { MultiResult } from '../multipeakTypes';
import type { XpsResult } from '../xpsTypes';
const props=defineProps<{result:MultiResult|XpsResult|null;hideActions?:boolean;stale:boolean;busy:boolean;unit:string;prefix:'multi'|'xps';accepted?:boolean;selectedPeak?:string}>();
const emit=defineEmits<{export:[kind:'curves'|'parameters'|'configuration'];image:[];select:[id:string]}>();
const exportMenu=ref<HTMLDetailsElement|null>(null);
watch(()=>props.result,()=>{if(exportMenu.value)exportMenu.value.open=false;});
const number=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':Number(v.toPrecision(6)).toString();
const percent=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':`${(v*100).toFixed(2)}%`;
const diagnosis=computed(()=>resultDiagnostics(props.result,{busy:props.busy,accepted:props.accepted}));
const peaks=computed(()=>props.result?presentPeaks(props.result):[]);
const warnings=computed(()=>diagnosis.value.warnings),warningTags=computed(()=>diagnosis.value.tags);
const metrics:Record<string,string>={r_squared:'R²（扣背景信号）',rmse:'RMSE',rss:'RSS',free_parameters:'独立自由参数',degrees_of_freedom:'自由度',residual_variance:'残差方差估计（强度²）',aicc:'AICc',bic:'BIC',durbin_watson:'Durbin–Watson'};
function download(kind:'curves'|'parameters'|'configuration'|'image'){
  if(props.stale||props.busy)return;
  if(kind==='image')emit('image');else emit('export',kind);
  if(exportMenu.value)exportMenu.value.open=false;
}
</script>

<template>
  <section class="panel xps-results compact-fit-results">
    <div class="panel-title compact-result-heading">
      <h2>拟合结果</h2>
      <details v-if="result&&!hideActions" ref="exportMenu" class="result-export-menu" data-test="result-export-menu">
        <summary>导出</summary>
        <div class="result-export-options">
          <button :disabled="stale||busy" @click="download('curves')" :data-test="`${prefix}-export-curves`">曲线 CSV</button>
          <button :disabled="stale||busy" @click="download('parameters')">参数 CSV</button>
          <button :disabled="stale||busy" @click="download('configuration')" :data-test="`${prefix}-export-config`">配置 JSON</button>
          <button :disabled="stale||busy" @click="download('image')">谱图 PNG</button>
        </div>
      </details>
    </div>
    <p v-if="!result" class="hint">暂无拟合结果</p>
    <template v-else>
      <p v-if="stale" class="xps-warning" :data-test="`${prefix}-stale`">结果已过期；重新拟合后可导出。</p>
      <div class="compact-result-summary" data-test="result-summary">
        <strong :class="{'result-not-converged':!result.converged}">计算：{{diagnosis.calculation}}</strong>
        <span>{{result.components.length}} 个峰</span>
        <span>R²（扣背景） <b>{{number(result.statistics.r_squared)}}</b></span>
        <span>RMSE <b>{{number(result.statistics.rmse)}}</b></span>
      </div>
      <p class="result-diagnostic-state" role="status">诊断：{{diagnosis.diagnostic}} · 人工状态：{{diagnosis.review}}</p><p class="hint">收敛不等于模型适用。</p>
      <details v-if="diagnosis.notes.length" class="result-details"><summary>计算口径</summary><p v-for="note in diagnosis.notes" :key="note" class="hint">{{note}}</p></details>
      <details v-if="warningTags.length" class="compact-result-warnings" data-test="result-warnings">
        <summary data-test="result-warning-summary"><span>⚠ 需要复核</span><span v-for="tag in warningTags" :key="tag" class="result-warning-tag">{{tag}}</span><span class="warning-detail-label">展开详情</span></summary>
        <ul v-if="warnings.length"><li v-for="warning in warnings" :key="warning">{{warning}}</li></ul>
        <p v-if="!result.converged">本次优化未收敛，请检查初值、分析区间和求解设置。</p>
        <p v-if="!result.diagnostics.identifiable">参数不可独立辨识，请检查峰数与参数约束。</p>
        <p v-if="!result.diagnostics.uncertainty_available">部分标准误不可用，请展开对应峰查看参数原因。</p>
        <p v-for="pair in result.diagnostics.strong_correlations" :key="pair.a+pair.b">{{pair.a}} / {{pair.b}}：{{number(pair.correlation)}}</p>
      </details>
      <PeakResultTable :peaks="peaks" :unit="unit" :stale="stale" :selected-peak="selectedPeak" @select="emit('select',$event)" />
      <SamplingDiagnostics :x="result.x??[]" :peaks="peaks" :unit="unit" :xrd="result.configuration&&'analysis_mode' in result.configuration&&result.configuration.analysis_mode==='xrd'" />
      <details v-if="result.groups.length" class="result-details">
        <summary>峰组汇总（{{result.groups.length}}）</summary>
        <div class="compact-result-table"><table><thead><tr><th>峰组</th><th>全域面积 / Y × {{unit}}</th><th>区间面积 / Y × {{unit}}</th><th>区间面积占比</th></tr></thead><tbody><tr v-for="g in result.groups" :key="g.id"><th>{{g.id}} · {{g.label}}</th><td>{{number(g.area_total)}}</td><td>{{number(g.area_window)}}</td><td>{{percent(g.area_fraction_window)}}</td></tr></tbody></table></div>
      </details>
      <details class="result-details" data-test="result-statistics">
        <summary>统计与求解详情</summary>
        <div class="xps-status"><span>{{result.diagnostics.identifiable?'数值满秩':'不可独立辨识'}}</span><span>{{result.diagnostics.uncertainty_available?'条件标准误可用':'部分标准误不可用'}}</span></div>
        <p class="hint">{{result.message}}（{{result.evaluations}} 次求值）</p>
        <table><tbody><tr v-for="(label,key) in metrics" :key="key"><th>{{label}}</th><td>{{number(result.statistics[key])}}</td></tr></tbody></table>
        <p class="hint">不同背景的 AICc/BIC 不宜直接比较。标准误的适用条件见诊断提示及各峰参数详情。</p>
      </details>
    </template>
  </section>
</template>

<style scoped>
.compact-result-heading{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.compact-result-heading{margin-bottom:12px;padding-bottom:12px}
.compact-result-summary{display:flex;align-items:center;gap:10px 22px;flex-wrap:wrap;font-size:14px;font-variant-numeric:tabular-nums}
.compact-result-summary strong{color:#17613e}.compact-result-summary .result-not-converged{color:#963c17}
.compact-result-warnings{margin:12px 0;border:1px solid #e0bd7c;border-left:3px solid #b57a16;border-radius:5px;background:#fff8e8;color:#744208;padding:0 10px;font-size:13px}
.compact-result-warnings summary{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:9px 0}
.compact-result-warnings ul{margin:6px 0 10px;padding-left:20px}
.result-warning-tag{display:inline-block;padding:2px 6px;border:1px solid #d8b374;border-radius:4px;background:#fff4dc;color:#744208;font-size:12px}
.warning-detail-label{margin-left:auto;font-weight:400;text-decoration:underline}
.compact-result-table{width:100%;overflow-x:auto;margin-top:12px}
.compact-result-table table{margin:0;min-width:560px;font-variant-numeric:tabular-nums}
.compact-result-table th,.compact-result-table td{padding:9px 10px}
.compact-result-table td{white-space:nowrap}
.compact-result-table th small{font-size:11px;font-weight:400}
.compact-result-table tbody th{max-width:240px}
.peak-detail-toggle{height:auto;min-height:32px;text-align:left;white-space:normal;overflow-wrap:anywhere;border:0;padding:2px 0;background:transparent;font-weight:600}
.peak-expanded th,.peak-expanded td{background:var(--ui-selected)}
.compact-area-note{font-size:12px;margin:8px 0}
.peak-detail-link{display:block;font-size:12px;font-weight:400;color:var(--ui-text-muted);text-decoration:underline}
.peak-result-dialog{width:min(900px,calc(100vw - 32px));max-height:calc(100dvh - 32px)}
.peak-detail-content{display:flex;flex-direction:column;min-height:0;max-height:calc(100dvh - 34px)}
.peak-result-dialog .parameter-dialog-body{overscroll-behavior:contain}
.peak-result-dialog .compact-result-table{margin-top:0}
.parameter-state{display:inline-block;border:1px solid var(--ui-border);border-radius:4px;padding:2px 6px;font-size:12px}
.result-export-menu{position:relative;margin-left:auto}
.result-export-menu summary{border:1px solid var(--ui-border);border-radius:5px;padding:6px 12px;font-size:13px}
.result-export-options{position:absolute;right:0;top:100%;z-index:20;display:grid;gap:6px;min-width:150px;padding:8px;background:var(--ui-surface);border:1px solid var(--ui-border);border-radius:6px;box-shadow:0 4px 12px #0002}
@media(max-width:600px){.compact-result-summary{gap:8px 16px}.compact-result-table th,.compact-result-table td{padding:8px}.compact-result-table{scrollbar-gutter:stable}.peak-result-dialog .parameter-dialog-footer{flex-wrap:wrap}.peak-result-dialog .parameter-dialog-body{padding:12px}}
</style>
