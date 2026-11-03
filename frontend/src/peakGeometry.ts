import type { FitResult } from "./types";
import type { XpsParameterResult } from './xpsTypes';

export interface PeakGeometry {
  peak_height_uncertainty?: {standard_error:number|null; confidence_interval:[number,number]|null; reason:string|null};
  peak_position:number|null; peak_height:number|null; fwhm:number|null;
  hwhm_low:number|null; hwhm_high:number|null; halfmax_low:number|null; halfmax_high:number|null;
  area_total:number|null; area_in_range:number|null; area_fraction_in_range:number|null;
  range_start:number; range_end:number; halfmax_within_range:boolean|null;
  reasons:Record<string,string>; warnings:string[];
  area_method:string; width_method:string; uncertainty_note:string;
}

export function peakHeightUncertainty(geometry?:PeakGeometry) {
  return geometry?.peak_height_uncertainty ?? {standard_error:null, confidence_interval:null, reason:'历史结果未记录峰高不确定度'};
}

export function derivedUncertainty(component:{model:string;parameters:Record<string,XpsParameterResult>;peak_geometry?:PeakGeometry},name:string) {
  if(name==='height')return peakHeightUncertainty(component.peak_geometry);
  const p=name==='area_total'?component.parameters.A:
    name==='fwhm'&&['gaussian','lorentz','psd_voigt1'].includes(component.model)?component.parameters.w:undefined;
  return {standard_error:p?.standard_error??null,confidence_interval:p?.confidence_interval??null,
    reason:p?p.uncertainty_reason??(p.confidence_interval?null:'结果未记录 95% 置信区间'):'派生性质未计算标准误和置信区间'};
}

export function overallWidthText(result:Pick<FitResult,"peak_geometry"|"parameters"|"model">, unit:string):string {
  const geometry=result.peak_geometry;
  if(geometry) return geometry.fwhm==null
    ? `整体 FWHM：${geometry.reasons.fwhm??"无法计算"}`
    : `整体 FWHM = ${geometry.fwhm.toPrecision(6)} ${unit}${geometry.halfmax_within_range===false?"（半高点超出区间）":""}`;
  if(result.model==="psd_voigt2")return "整体 FWHM：未计算，需重新拟合";
  const width=result.parameters.w?.value;
  return width==null?"整体 FWHM：未计算，需重新拟合":`整体 FWHM = ${width.toPrecision(6)} ${unit}`;
}
