"""Local FastAPI entry point for the single-peak fitting application."""

from __future__ import annotations

import csv
import hashlib
from dataclasses import dataclass
from io import StringIO
from pathlib import Path
from time import monotonic
from uuid import uuid4

import numpy as np
from fastapi import FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .baselines import Anchor
from .datasets import ParsedWorkbook, parse_upload, select_xy
from .fitting import FitInput, FitResult, analyze_single_peak, compare_single_peak_models, fit_single_peak, preview_fixed_baseline
from .schemas import ExportPayload, FitPayload, ModelComparisonPayload, PreviewPayload
from .xps_routes import router as xps_router
from .peak_properties import geometry_rows


MAX_UPLOAD_BYTES = 25 * 1024 * 1024
DATASET_TTL_SECONDS = 60 * 60


@dataclass(slots=True)
class StoredDataset:
    workbook: ParsedWorkbook
    created_at: float


app = FastAPI(title="单峰拟合工具", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5175", "http://127.0.0.1:5175"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

_datasets: dict[str, StoredDataset] = {}


def _discard_expired_datasets() -> None:
    cutoff = monotonic() - DATASET_TTL_SECONDS
    for dataset_id, stored in list(_datasets.items()):
        if stored.created_at < cutoff:
            del _datasets[dataset_id]


def _sheet_summary(workbook: ParsedWorkbook) -> list[dict[str, object]]:
    return [
        {
            "name": sheet.name,
            "columns": [str(column) for column in sheet.frame.columns],
            "numeric_columns": sheet.numeric_columns,
            "row_count": int(len(sheet.frame)),
            "preview_rows": sheet.frame.head(5).where(sheet.frame.notna(), None).to_dict(orient="records"),
        }
        for sheet in workbook.sheets
    ]


def fit_result_to_dict(result: FitResult) -> dict[str, object]:
    """Translate numerical-domain dataclasses into JSON-safe plot payloads."""
    return {
        "x": result.x.tolist(),
        "raw_y": result.raw_y.tolist(),
        "baseline": result.baseline.tolist(),
        "net_y": result.net_y.tolist(),
        "peak_y": result.peak_y.tolist(),
        "total_y": result.total_y.tolist(),
        "residual": result.residual.tolist(),
        "parameters": {
            name: {
                "value": value.value,
                "standard_error": value.standard_error,
                "confidence_interval": value.confidence_interval,
                "lower_bound": value.lower_bound,
                "upper_bound": value.upper_bound,
                "fixed": value.fixed,
                "uncertainty_reason": value.uncertainty_reason,
            }
            for name, value in result.parameters.items()
        },
        "statistics": {
            "r_squared": result.statistics.r_squared,
            "adjusted_r_squared": result.statistics.adjusted_r_squared,
            "rmse": result.statistics.rmse,
            "sse": result.statistics.sse,
            "points": result.statistics.points,
            "free_parameters": result.statistics.free_parameters,
            "degrees_of_freedom": result.statistics.degrees_of_freedom,
            "reduced_chi_square": result.statistics.reduced_chi_square,
            "residual_mean": result.statistics.residual_mean,
            "residual_standard_deviation": result.statistics.residual_standard_deviation,
            "durbin_watson": result.statistics.durbin_watson,
            "outlier_count": result.statistics.outlier_count,
            "has_trend": result.statistics.has_trend,
        },
        "converged": result.converged,
        "message": result.message,
        "model": result.model,
        "range_start": result.range_start,
        "range_end": result.range_end,
        "baseline_configuration": result.baseline_configuration,
        "solver": result.solver,
        "iterations": result.iterations,
        "covariance_matrix": result.covariance_matrix,
        "correlation_matrix": result.correlation_matrix,
        "derived_parameters": result.derived_parameters,
        "peak_geometry": result.peak_geometry,
        "analysis_metadata": result.analysis_metadata,
        "fit_stages": result.fit_stages,
    }


@app.post("/api/datasets")
async def upload_dataset(file: UploadFile = File(...)) -> dict[str, object]:
    """Read a local upload into a short-lived in-memory dataset registry."""
    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="文件过大；单个文件不能超过 25 MB")
        workbook = parse_upload(file.filename or "未命名文件", content)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    dataset_id = str(uuid4())
    _discard_expired_datasets()
    _datasets[dataset_id] = StoredDataset(workbook=workbook, created_at=monotonic())
    return {"dataset_id": dataset_id, "filename": workbook.filename, "file_sha256": hashlib.sha256(content).hexdigest(), "sheets": _sheet_summary(workbook)}


@app.post("/api/preview")
def preview(payload: PreviewPayload) -> dict[str, list[float]]:
    """Return selected data without retaining a copy in browser storage."""
    _discard_expired_datasets()
    stored = _datasets.get(payload.dataset_id)
    if stored is None:
        raise HTTPException(status_code=404, detail="数据已失效，请重新导入文件")
    try:
        x, y = select_xy(stored.workbook, payload.sheet, payload.x_column, payload.y_column)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"x": x.tolist(), "y": y.tolist()}


@app.post("/api/fit")
def fit(payload: FitPayload) -> dict[str, object]:
    """Run one baseline-aware, bounded peak fit and return graph-ready curves."""
    request = FitInput(
        x=np.asarray(payload.x, dtype=float),
        y=np.asarray(payload.y, dtype=float),
        model=payload.model,
        baseline_kind=payload.baseline_kind,
        anchors=[Anchor(anchor.x, anchor.y) for anchor in payload.anchors],
        degree=payload.degree,
        smoothing=payload.smoothing,
        range_start=payload.range_start,
        range_end=payload.range_end,
        initial_parameters=payload.initial_parameters,
        parameter_bounds={name: (bounds.lower, bounds.upper) for name, bounds in payload.parameter_bounds.items()},
        fixed_parameters=payload.fixed_parameters,
        anchor_source=payload.anchor_source,
        baseline_confirmed=payload.baseline_confirmed,
        staged_fit=payload.staged_fit,
        center_lock_evaluations=payload.center_lock_evaluations,
        max_function_evaluations=payload.max_function_evaluations,
        tolerance=payload.tolerance,
    )
    try:
        return fit_result_to_dict(fit_single_peak(request))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/model-comparison")
def model_comparison(payload: ModelComparisonPayload) -> dict[str, object]:
    """Return advisory model evidence while leaving the active analyst choice unchanged."""
    request = FitInput(
        x=np.asarray(payload.x, dtype=float), y=np.asarray(payload.y, dtype=float), model=payload.model,
        baseline_kind=payload.baseline_kind, anchors=[Anchor(anchor.x, anchor.y) for anchor in payload.anchors],
        degree=payload.degree, smoothing=payload.smoothing, range_start=payload.range_start, range_end=payload.range_end,
        initial_parameters=payload.initial_parameters,
        parameter_bounds={name: (bounds.lower, bounds.upper) for name, bounds in payload.parameter_bounds.items()},
        fixed_parameters=payload.fixed_parameters, anchor_source=payload.anchor_source,
        baseline_confirmed=payload.baseline_confirmed, staged_fit=payload.staged_fit,
        center_lock_evaluations=payload.center_lock_evaluations,
        max_function_evaluations=payload.max_function_evaluations, tolerance=payload.tolerance,
    )
    try:
        comparison = compare_single_peak_models(request, include_asymmetric=payload.include_asymmetric)
        return {"active_model": comparison.active_model, "recommended_model": comparison.recommended_model, "rows": comparison.rows}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/auto-peak-analysis")
def auto_peak_analysis(payload: FitPayload) -> dict[str, object]:
    """Provide auditable automatic starting estimates without performing a final fit."""
    request = FitInput(
        x=np.asarray(payload.x, dtype=float), y=np.asarray(payload.y, dtype=float), model=payload.model,
        baseline_kind=payload.baseline_kind, anchors=[Anchor(anchor.x, anchor.y) for anchor in payload.anchors],
        degree=payload.degree, smoothing=payload.smoothing, range_start=payload.range_start, range_end=payload.range_end,
        anchor_source=payload.anchor_source, baseline_confirmed=payload.baseline_confirmed,
    )
    try:
        analysis = analyze_single_peak(request)
        return {
            "initial_parameters": analysis.initial_parameters, "candidate_count": analysis.candidate_count,
            "selected_index": analysis.selected_index, "prominence": analysis.prominence,
            "smoothing_window": analysis.smoothing_window, "method": analysis.method, "model": payload.model,
            "warnings": analysis.warnings,
        }
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/baseline-preview")
def baseline_preview(payload: FitPayload) -> dict[str, list[float]]:
    """Calculate the exact fixed baseline so it can be reviewed before fitting."""
    request = FitInput(
        x=np.asarray(payload.x, dtype=float),
        y=np.asarray(payload.y, dtype=float),
        model=payload.model,
        baseline_kind=payload.baseline_kind,
        anchors=[Anchor(anchor.x, anchor.y) for anchor in payload.anchors],
        degree=payload.degree,
        smoothing=payload.smoothing,
        range_start=payload.range_start,
        range_end=payload.range_end,
    )
    try:
        x, _, baseline, _ = preview_fixed_baseline(request)
        return {"x": x.tolist(), "baseline": baseline.tolist()}
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/export")
def export(payload: ExportPayload) -> Response:
    """Export every fitted curve or the complete parameter/statistics table as CSV."""
    buffer = StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\n")
    result = payload.result
    if payload.kind == "curves":
        names = ["x", "raw_y", "baseline", "net_y", "peak_y", "total_y", "residual"]
        columns = [result.get(name) for name in names]
        if not all(isinstance(column, list) for column in columns) or len({len(column) for column in columns}) != 1:
            raise HTTPException(status_code=422, detail="曲线导出需要长度一致的全部拟合曲线")
        writer.writerow(names)
        writer.writerows(zip(*columns, strict=True))
        filename = "curves.csv"
    else:
        parameters = result.get("parameters")
        statistics = result.get("statistics")
        if not isinstance(parameters, dict) or not isinstance(statistics, dict):
            raise HTTPException(status_code=422, detail="参数导出需要参数和拟合统计量")
        writer.writerow(["parameter", "value", "standard_error", "ci95_lower", "ci95_upper", "lower_bound", "upper_bound", "fixed", "uncertainty_reason"])
        for name, value in parameters.items():
            if not isinstance(value, dict):
                raise HTTPException(status_code=422, detail="参数格式无效")
            confidence_interval = value.get("confidence_interval")
            lower_ci, upper_ci = (confidence_interval if isinstance(confidence_interval, list) and len(confidence_interval) == 2 else (None, None))
            writer.writerow([
                name, value.get("value"), value.get("standard_error"), lower_ci, upper_ci,
                value.get("lower_bound"), value.get("upper_bound"), value.get("fixed"), value.get("uncertainty_reason"),
            ])
        writer.writerow([])
        writer.writerow(["fit_configuration", "value"])
        writer.writerow(["model", result.get("model", "")])
        writer.writerow(["range_start", result.get("range_start", "")])
        writer.writerow(["range_end", result.get("range_end", "")])
        baseline = result.get("baseline_configuration", {})
        if isinstance(baseline, dict):
            for name, value in baseline.items():
                writer.writerow([f"baseline_{name}", value])
        for name in ("solver", "iterations", "converged", "message"):
            writer.writerow([name, result.get(name, "")])
        metadata = result.get("analysis_metadata", {})
        if isinstance(metadata, dict):
            for name, value in metadata.items():
                writer.writerow([f"analysis_{name}", value])
        writer.writerow([])
        writer.writerow(["metric", "value"])
        writer.writerows(statistics.items())
        derived = result.get("derived_parameters", {})
        if isinstance(derived, dict):
            writer.writerow([])
            writer.writerow(["derived_parameter", "value"])
            writer.writerows(derived.items())
            writer.writerow(["legacy.area_in_range.method", "采样点梯形积分"])
        if isinstance(result.get("peak_geometry"), dict):
            writer.writerow([])
            writer.writerow(["peak_geometry", "value", "unit", "reason"])
            writer.writerows(geometry_rows(result["peak_geometry"]))
        filename = "parameters.csv"
    return Response(
        content=buffer.getvalue(), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


app.include_router(xps_router)

frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
