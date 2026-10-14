import {snapshotPeaks,snapshotUnit,type AnalysisSnapshot} from './analysisSnapshot';
import {resultDiagnostics} from './resultDiagnostics';
import {samplingDiagnostics} from './samplingDiagnostics';
import {formatResultNumber as number} from './resultPresentation';
export const escapeHtml=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export interface ReportEntry {label:string;snapshot:AnalysisSnapshot|null;status:string;note?:string}
function chart(s:AnalysisSnapshot){
  const r=s.result,x=r.x,y=r.raw_y,fit=r.total_y,baseline=r.baseline;
  if(!x.length)return '<p>无图表数据</p>';
  let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
  x.forEach((v,i)=>{if(!Number.isFinite(v))return;xmin=Math.min(xmin,v);xmax=Math.max(xmax,v);for(const a of [y,fit,baseline])if(Number.isFinite(a[i])){ymin=Math.min(ymin,a[i]);ymax=Math.max(ymax,a[i]);}});
  if(!Number.isFinite(ymin))return '<p>图表数值不可用</p>';
  const coordinates=(ys:number[])=>x.flatMap((v,i)=>Number.isFinite(v)&&Number.isFinite(ys[i])?[`${(70+620*(s.engine==='xps'?(xmax-v):(v-xmin))/(xmax-xmin||1)).toFixed(2)},${(250-220*(ys[i]-ymin)/(ymax-ymin||1)).toFixed(2)}`]:[]).join(' ');
  return `<svg viewBox="0 0 760 300" role="img" aria-label="原谱、拟合及背景曲线"><path d="M70 25V250H700" fill="none" stroke="#333"/><polyline points="${coordinates(y)}" fill="none" stroke="#666"/><polyline points="${coordinates(fit)}" fill="none" stroke="#0072b2" stroke-width="1.7"/><polyline points="${coordinates(baseline)}" fill="none" stroke="#333" stroke-dasharray="5 3"/><text x="65" y="270">${number(s.engine==='xps'?xmax:xmin)}</text><text x="670" y="270">${number(s.engine==='xps'?xmin:xmax)}</text><text x="10" y="35">${number(ymax)}</text><text x="10" y="245">${number(ymin)}</text><text x="330" y="293">${escapeHtml(snapshotUnit(s))}</text></svg><p class="small">灰色：原谱；蓝色：总拟合；虚线：背景。按保存观测点绘制，未抽样或归一化。纵轴为原强度单位。</p>`;
}
export function analysisReport(entries:ReportEntry[],note=''){
  const e=escapeHtml;
  const sections=entries.map(item=>{
    if(!item.snapshot)return `<section><h2>${e(item.label)}</h2><p>状态：${e(item.status)}；没有可用结果。</p><p>${e(item.note)}</p></section>`;
    const s=item.snapshot,c=s.configuration,r=s.result,d=resultDiagnostics(r,{accepted:s.accepted}),source=c.source,background='baseline' in c?c.baseline:c.background;
    const rows=snapshotPeaks(s).map(p=>{const support=samplingDiagnostics(r.x,p.geometry);return `<tr><th>${e(p.id)} · ${e(p.label)}</th><td>${e(p.model)}</td><td>${number(p.geometry?.peak_position)}</td><td>${number(p.geometry?.fwhm)}</td><td>${number(p.areaWindow)}</td><td>${number(p.areaTotal)}</td><td>${support.count??'—'} / ${number(support.median)}</td></tr>`;}).join('');
    return `<section><h2>${e(item.label)}</h2><p class="state">${s.stale?'过期结果：仅供追溯，不代表当前配置。':'已保存结果快照'} 状态：${e(item.status)}；计算：${e(d.calculation)}；诊断：${e(d.diagnostic)}；人工状态：${e(d.review)}</p>
      <p>来源：${e(source?.filename??'未提供')} / ${e(source?.sheet)} / X=${e(source?.x_column)} / Y=${e(source?.y_column)}<br>原文件 SHA-256：${e(source?.file_sha256??'未提供')}</p>
      <p>区间 ${number(c.range_start)} — ${number(c.range_end)} ${e(snapshotUnit(s))}；背景 ${e(background.kind)}；求解路径 ${e(s.engine)}；等权残差最小二乘。${'shift_eV' in c?`XPS 位移 ${number(c.shift_eV)} eV；校准依据：${e(c.calibration_note)}`:''}</p>
      <p>R²（扣背景信号） ${number(r.statistics.r_squared)}；RMSE ${number(r.statistics.rmse)}。${'analysis_mode' in c&&c.analysis_mode==='xrd'?'XRD 为观测峰宽，未扣除仪器展宽。':''}</p>
      <ul>${d.warnings.map(w=>`<li>${e(w)}</li>`).join('')}</ul>${chart(s)}
      <div class="table-scroll" role="region" aria-label="峰性质表格" tabindex="0"><table><thead><tr><th>峰 ID / 标签</th><th>模型</th><th>峰顶 / ${e(snapshotUnit(s))}</th><th>FWHM / ${e(snapshotUnit(s))}</th><th>区间面积</th><th>全域面积</th><th>半高区点数 / 间隔中位数</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small">面积单位 Y × ${e(snapshotUnit(s))}；全域面积含区间外模型外推。面积占比非原子百分比。标准误是当前模型条件下的参数不确定度，派生性质不提供标准误。收敛不等于模型适用。</p>
      <h3>配置与约束记录</h3><pre>${e(JSON.stringify({components:c.components,constraints:c.constraints,background,solver:c.solver,single_solver_settings:s.singleSettings},null,2))}</pre>
      <h3>软件数值与诊断记录</h3><pre>${e(JSON.stringify({statistics:r.statistics,parameters:'parameters' in r?r.parameters:r.components.map(p=>({id:p.id,parameters:p.parameters})),warnings:d.warnings},null,2))}</pre><p>${e(item.note)}</p></section>`;
  }).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>谱线拟合分析摘要</title><style>body{font:15px/1.6 Arial,"Microsoft YaHei",sans-serif;color:#222;max-width:1100px;margin:24px auto;padding:16px}h1,h2{line-height:1.3}section{border-top:1px solid #aaa;margin-top:28px;padding-top:20px}svg{width:100%;max-height:420px}.table-scroll{overflow-x:auto}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #ccc;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f6f6f6;padding:12px}p{overflow-wrap:anywhere}.small{font-size:12px}.state{font-weight:bold}@media print{body{margin:0;padding:0;font-size:11pt}section{break-before:page}h2,h3{break-after:avoid}svg,tr{break-inside:avoid}.table-scroll{overflow:visible}pre{font-size:8pt}}</style></head><body><h1>谱线拟合分析摘要</h1><p>生成时间：${e(new Date().toISOString())}（UTC）。本摘要引用保存结果，不重新拟合。可用浏览器打印／另存 PDF。</p><h2>用户备注（非软件计算结论）</h2><p>${e(note||'未填写')}</p>${sections}<p>本工具不自动推断材料机理、化学态或晶粒尺寸。参数置信区间仅在当前模型条件下成立，方案差异不是置信区间；结论须结合实验设计与其他证据。</p></body></html>`;
}
