import type { PeakGeometry } from "./peakGeometry";
export type XpsModel = "gaussian" | "lorentz" | "psd_voigt1" | "split_psd_voigt" | "emg_high" | "emg_low";
export type ParamName = "A" | "xc" | "w" | "mu" | "h_low" | "h_high" | "sigma" | "tau";
export interface XpsParameter { value: number; lower?: number | null; upper?: number | null; fixed: boolean }
export interface XpsComponent { id: string; label: string; enabled: boolean; model: XpsModel; parameters: Partial<Record<ParamName, XpsParameter>> }
export interface XpsConstraint { target: {component: string; parameter: ParamName}; source: {component: string; parameter: ParamName}; kind: "offset" | "ratio"; value: number }
export interface XpsGroup { id: string; label: string; component_ids: string[] }
export interface XpsSource { filename: string; file_sha256: string; sheet: string; x_column: string; y_column: string }
export interface XpsBackground {
  kind: "none" | "line" | "shirley"; low_window: [number,number] | null; high_window: [number,number] | null;
  low_level: number | null; high_level: number | null; tolerance: number; max_iterations: number; confirmed: boolean;
}
export interface XpsRequest {
  schema_version: 1 | 2; x: number[]; y: number[]; range_start: number; range_end: number;
  shift_eV: number; calibration_note: string; background: XpsBackground;
  components: XpsComponent[]; constraints: XpsConstraint[]; groups: XpsGroup[];
  solver: {max_nfev: number; tolerance: number}; source: XpsSource | null;
}
export interface XpsPreview {
  x: number[]; x_raw: number[]; raw_y: number[]; baseline: number[];
  background: {kind:string; iterations:number; converged:boolean; low_level?:number; high_level?:number};
}
export interface XpsParameterResult {value:number; standard_error:number|null; uncertainty_reason:string|null; linked_to:string|null; fixed:boolean; bound:boolean}
export interface XpsComponentResult {
  id:string; label:string; model:XpsModel; parameters:Record<string,XpsParameterResult>; y:number[];
  area_total:number; area_window:number; area_fraction_window:number|null; height:number; fwhm:number|null;
  peak_geometry?: PeakGeometry;
}
export interface XpsResult extends XpsPreview {
  components:XpsComponentResult[]; groups:(XpsGroup & {area_total:number;area_window:number;area_fraction_window:number|null})[];
  total_y:number[]; residuals:number[]; converged:boolean; message:string; evaluations:number;
  configuration:XpsRequest; data_sha256:string; statistics:Record<string,number|null>;
  diagnostics:{identifiable:boolean; uncertainty_available:boolean; jacobian_rank:number; scaled_condition:number|null;
    bound_parameters:string[]; strong_correlations:{a:string;b:string;correlation:number}[];lag1_correlation:number|null;warnings:string[]};
}
export interface Candidate {xc:number;A:number;w:number;mu:number;prominence:number}
