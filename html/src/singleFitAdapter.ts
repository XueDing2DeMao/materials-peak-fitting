import type { FitRequest, FitResult } from './types';
import type { MultiComponent, MultiRequest } from './multipeakTypes';
import type { MultiPlotResult } from './multipeakTraces';
import { PEAK_MODEL_PARAMETERS } from './peakModels';

export interface SingleSolverSettings { staged: boolean; centerEvaluations: number }
export function singleRequest(config: MultiRequest, settings: SingleSolverSettings): FitRequest {
  const enabled = config.components.filter(c => c.enabled);
  if (enabled.length !== 1) throw new Error('单峰求解需要恰好一个启用峰');
  if (config.constraints.length) throw new Error('单峰求解前请解除峰间关联，或启用关联的所有峰');
  const peak = enabled[0], initial_parameters: FitRequest['initial_parameters'] = {}, parameter_bounds: FitRequest['parameter_bounds'] = {}, fixed_parameters: FitRequest['fixed_parameters'] = {};
  const names=PEAK_MODEL_PARAMETERS[peak.model];
  if(!names||names.some(name=>!peak.parameters[name])||Object.keys(peak.parameters).length!==names.length)throw new Error('峰形参数不完整');
  for (const [name, p] of Object.entries(peak.parameters)) {
    if (!p) continue;
    if(!Number.isFinite(p.value)||(p.lower!=null&&!Number.isFinite(p.lower))||(p.upper!=null&&!Number.isFinite(p.upper)))throw new Error(`${name} 参数必须为有限数值`);
    initial_parameters[name] = p.value;
    if (p.lower != null || p.upper != null) parameter_bounds[name] = { ...(p.lower != null ? { lower: p.lower } : {}), ...(p.upper != null ? { upper: p.upper } : {}) };
    if (p.fixed) fixed_parameters[name] = p.value;
  }
  return { x: config.x, y: config.y, model: peak.model, baseline_kind: config.baseline.kind, anchors: config.baseline.anchors,
    degree: config.baseline.degree, smoothing: config.baseline.smoothing, range_start: config.range_start, range_end: config.range_end,
    initial_parameters, parameter_bounds, fixed_parameters, anchor_source: config.baseline.anchors.length ? 'manual' : 'endpoint_default',
    baseline_confirmed: config.baseline.confirmed, staged_fit: settings.staged, center_lock_evaluations: settings.centerEvaluations,
    max_function_evaluations: config.solver.max_nfev, tolerance: config.solver.tolerance };
}
export function readSingleSettings(value: unknown): SingleSolverSettings {
  if(value===undefined)return {staged:true,centerEvaluations:20};
  const s=value as SingleSolverSettings|null;
  if(!s||typeof s.staged!=='boolean'||!Number.isInteger(s.centerEvaluations)||s.centerEvaluations<0||s.centerEvaluations>500)throw new Error('单峰分阶段求解设置无效');
  return {staged:s.staged,centerEvaluations:s.centerEvaluations};
}
// 只适配绘图数据，不把单峰统计伪装成联合拟合诊断。
export function singlePlot(result: FitResult, component: MultiComponent): MultiPlotResult {
  return { x: result.x, total_y: result.total_y, residuals: result.residual,
    components: [{ id: component.id, label: component.label, y: result.peak_y, parameters: result.parameters }] };
}
