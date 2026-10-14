import type { FitResult, ParameterEstimate } from './types';
import type { BatchResult } from './batchTypes';
import type { PeakGeometry } from './peakGeometry';

/** 仅供展示，保留后端数值，不改变求解与导出格式。 */
export interface PresentedPeak {
  id:string;label:string;model:string;
  parameters:Record<string,ParameterEstimate&{linked_to?:string|null;bound?:boolean}>;
  geometry?:PeakGeometry;areaTotal:number|null;areaWindow:number|null;areaFraction:number|null;
}
export const formatResultNumber=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'—':Number(v.toPrecision(6)).toString();
export function presentSinglePeak(result:FitResult,id='p1',label='峰 1'):PresentedPeak {
  return {id,label,model:result.model??'',parameters:result.parameters,geometry:result.peak_geometry,
    areaTotal:result.peak_geometry?.area_total??null,areaWindow:result.peak_geometry?.area_in_range??null,
    areaFraction:result.peak_geometry?.area_in_range!=null&&result.peak_geometry.area_in_range>0?1:null};
}
export function presentPeaks(result:BatchResult):PresentedPeak[]{
  return result.components.map(c=>({id:c.id,label:c.label,model:c.model,parameters:c.parameters,geometry:c.peak_geometry,
    areaTotal:c.area_total,areaWindow:c.area_window,areaFraction:c.area_fraction_window}));
}
