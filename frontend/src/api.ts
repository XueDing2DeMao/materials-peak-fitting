import type { AutoPeakAnalysis, BaselinePreview, DatasetInfo, FitRequest, FitResult, ModelComparison } from "./types";

const baseUrl = import.meta.env.DEV ? "http://127.0.0.1:5176" : "";

async function request<T>(path: string, options: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "请求失败" }));
    throw new Error(typeof body.detail === "string" ? body.detail : "请求参数无效");
  }
  return response.json() as Promise<T>;
}

export function uploadDataset(file: File): Promise<DatasetInfo> {
  const form = new FormData(); form.append("file", file);
  return request("/api/datasets", { method: "POST", body: form });
}
export function previewDataset(datasetId: string, sheet: string, xColumn: string, yColumn: string): Promise<{ x: number[]; y: number[] }> {
  return request("/api/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dataset_id: datasetId, sheet, x_column: xColumn, y_column: yColumn }) });
}
export function runFit(payload: FitRequest): Promise<FitResult> {
  return request("/api/fit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function previewBaseline(payload: FitRequest): Promise<BaselinePreview> {
  return request("/api/baseline-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function analyzePeak(payload: FitRequest): Promise<AutoPeakAnalysis> {
  return request("/api/auto-peak-analysis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
}
export function compareModels(payload: FitRequest, includeAsymmetric=false): Promise<ModelComparison> {
  return request("/api/model-comparison", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({...payload,include_asymmetric:includeAsymmetric}) });
}
export async function downloadExport(kind: "curves" | "parameters", result: FitResult): Promise<Blob> {
  const response = await fetch(`${baseUrl}/api/export`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, result }) });
  if (!response.ok) throw new Error("导出失败");
  return response.blob();
}
