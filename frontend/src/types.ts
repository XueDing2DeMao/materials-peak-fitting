import type { PeakGeometry } from "./peakGeometry";
export type PeakModel = "gaussian" | "lorentz" | "psd_voigt1" | "psd_voigt2" | "split_psd_voigt" | "emg_high" | "emg_low";
export type BaselineKind = "none" | "constant" | "line" | "polynomial" | "spline" | "bspline";

export interface Anchor { x: number; y: number }
export interface BaselinePreview { x: number[]; baseline: number[] }
export interface AutoPeakAnalysis {
  warnings?: string[];
  model: PeakModel;
  initial_parameters: Record<string, number>;
  candidate_count: number;
  selected_index: number;
  prominence: number;
  smoothing_window: number;
  method: string;
}

export interface FitRequest {
  x: number[];
  y: number[];
  model: PeakModel;
  baseline_kind: BaselineKind;
  anchors: Anchor[];
  degree: number;
  smoothing: number;
  range_start: number;
  range_end: number;
  initial_parameters: Record<string, number>;
  parameter_bounds: Record<string, { lower?: number; upper?: number }>;
  fixed_parameters: Record<string, number>;
  anchor_source: "manual" | "suggested" | "endpoint_default";
  baseline_confirmed: boolean;
  staged_fit: boolean;
  center_lock_evaluations: number;
  max_function_evaluations: number;
  tolerance: number;
}

export interface ParameterEstimate {
  uncertainty_reason?: string | null;
  value: number;
  standard_error: number | null;
  confidence_interval?: [number, number] | null;
  lower_bound?: number | null;
  upper_bound?: number | null;
  fixed?: boolean;
}
export interface FitResult {
  peak_geometry?: PeakGeometry;
  x: number[]; raw_y: number[]; baseline: number[]; net_y: number[]; peak_y: number[]; total_y: number[]; residual: number[];
  parameters: Record<string, ParameterEstimate>;
  statistics: {
    r_squared: number; adjusted_r_squared: number | null; rmse: number; sse: number;
    points?: number; free_parameters?: number; degrees_of_freedom?: number; reduced_chi_square?: number | null;
    residual_mean?: number; residual_standard_deviation?: number; durbin_watson?: number | null;
    outlier_count?: number; has_trend?: boolean;
  };
  converged: boolean; message: string;
  model?: string; range_start?: number; range_end?: number; baseline_configuration?: Record<string, string | number>;
  solver?: string; iterations?: number;
  covariance_matrix?: number[][] | null; correlation_matrix?: number[][] | null;
  derived_parameters?: Record<string, number>; analysis_metadata?: Record<string, string>;
  fit_stages?: Array<{ name: string; center_fixed: boolean; evaluations: number; converged: boolean; initial_center?: number }>;
}

export interface SheetInfo { name: string; columns: string[]; numeric_columns: string[]; row_count: number; preview_rows: Array<Record<string, string | number | null>> }
export interface DatasetInfo { dataset_id: string; filename: string; file_sha256?: string; sheets: SheetInfo[] }

export interface ModelComparisonRow {
  model: PeakModel; converged: boolean; r_squared: number | null; rmse: number | null;
  aicc: number | null; bic: number | null; message: string;
}
export interface ModelComparison { active_model: PeakModel; recommended_model: PeakModel | null; rows: ModelComparisonRow[] }
