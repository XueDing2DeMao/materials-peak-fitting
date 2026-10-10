import type { FitResult } from "./types";

export interface PeakGeometry {
  peak_position:number|null; peak_height:number|null; fwhm:number|null;
  hwhm_low:number|null; hwhm_high:number|null; halfmax_low:number|null; halfmax_high:number|null;
  area_total:number|null; area_in_range:number|null; area_fraction_in_range:number|null;
  range_start:number; range_end:number; halfmax_within_range:boolean|null;
  reasons:Record<string,string>; warnings:string[];
  area_method:string; width_method:string; uncertainty_note:string;
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
