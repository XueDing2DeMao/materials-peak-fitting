"""XPS API 与可重现导出；导出从完整配置重新求解，避免拼接过期结果。"""
import csv
import json
from io import StringIO
from typing import Literal

import numpy as np
from fastapi import APIRouter, HTTPException, Response

from .xps_backgrounds import preview_background
from .xps_fitting import fit_xps, suggest_candidates
from .xps_schemas import StrictModel, XpsRequest
from .peak_properties import derived_error_cells, geometry_rows, quantity_unit
from .multipeak_core import validate_components
from .spectrum_units import column_unit

router = APIRouter(prefix="/api/xps", tags=["XPS"])


def checked(function, request):
    try:
        with np.errstate(over="raise", divide="raise", invalid="raise"):
            result = function(request)
        json.dumps(result, allow_nan=False)
        return result
    except (ValueError, FloatingPointError, OverflowError, np.linalg.LinAlgError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/background-preview")
def background_preview(request: XpsRequest):
    return checked(preview_background, request)


@router.post('/validate')
def validate_input(request: XpsRequest):
    def validate(r):
        preview=preview_background(r)
        validate_components(r,preview)
        return preview
    return checked(validate, request)


@router.post("/fit")
def run_fit(request: XpsRequest):
    return checked(fit_xps, request)


@router.post("/candidates")
def candidates(request: XpsRequest):
    return checked(suggest_candidates, request)


class XpsExport(StrictModel):
    kind: Literal["curves", "parameters", "configuration"]
    request: XpsRequest


@router.post("/export")
def export_xps(payload: XpsExport):
    request = payload.request.model_copy(update={"schema_version":payload.request.required_version()})
    result = checked(fit_xps, request)
    if payload.kind == "configuration":
        content = json.dumps({"schema_version": request.schema_version, "application": "peak-fitting-xps",
                              "request": request.model_dump(mode="json"), "result": result},
                             ensure_ascii=False, allow_nan=False, indent=2)
        return Response(content=content, media_type="application/json",
                        headers={"Content-Disposition": 'attachment; filename="xps-configuration.json"'})
    buffer = StringIO(newline="")
    writer = csv.writer(buffer)
    x_unit, y_unit = "eV", column_unit(request.source.y_column if request.source else "") or "Y 单位"
    if payload.kind == "curves":
        writer.writerow(["energy_raw_eV", "binding_energy_eV", "raw_y", "baseline", "total_y", "residual", "net_total"]+
                        ["component_"+c["id"] for c in result["components"]]+["x_unit", "y_unit"])
        for i in range(len(result["x"])):
            writer.writerow([result[key][i] for key in ("x_raw", "x", "raw_y", "baseline", "total_y", "residuals", "net_total")]+
                            [c["y"][i] for c in result["components"]]+[x_unit, y_unit])
    else:
        writer.writerow(["component", "label", "parameter", "value", "standard_error", "uncertainty_reason", "linked_to", "fixed", "bound", "model", "lower", "upper", "state", "unit", "ci95_lower", "ci95_upper"])
        # 防止用户提供的标签被表格软件解释为公式。
        def safe(text):
            return "'"+text if text.lstrip().startswith(("=", "+", "-", "@")) else text
        def derived_row(record, name):
            error,lower,upper,reason = derived_error_cells(name,record.get('model'),record.get('parameters',{}),record.get('peak_geometry',{}))
            return [safe(record["id"]), safe(record["label"]), name, record[name], error, reason, *([None]*7), quantity_unit(name,x_unit,y_unit), lower, upper]
        for c in result["components"]:
            for name, p in c["parameters"].items():
                state = "linked_fixed" if p["linked_to"] and p["fixed"] else "linked" if p["linked_to"] else "fixed" if p["fixed"] else "free"
                writer.writerow([c["id"], safe(c["label"]), name, p["value"], p["standard_error"], p["uncertainty_reason"], p["linked_to"], p["fixed"], p["bound"], c["model"], p["lower"], p["upper"], state, quantity_unit(name,x_unit,y_unit), *(p.get("confidence_interval") or [None,None])])
            for name in ("area_total", "area_window", "area_fraction_window", "height", "fwhm"):
                writer.writerow(derived_row(c,name))
        for group in result["groups"]:
            for name in ("area_total", "area_window", "area_fraction_window"):
                writer.writerow(derived_row(group,name))
        writer.writerow([])
        writer.writerow(["metric", "value", "unit"])
        writer.writerows([name,value,quantity_unit(name,x_unit,y_unit)] for name,value in result["statistics"].items())
        writer.writerow(["converged", result["converged"]])
        writer.writerow(["identifiable", result["diagnostics"]["identifiable"]])
        writer.writerow(["data_sha256", result["data_sha256"]])
        writer.writerow(["configuration_json", json.dumps(result["configuration"], ensure_ascii=False, allow_nan=False)])
        writer.writerow([])
        writer.writerow(["component", "property", "value", "unit", "reason", "standard_error", "ci95_lower", "ci95_upper"])
        for c in result['components']:
            for row in geometry_rows(c['peak_geometry'], x_unit, y_unit):writer.writerow([c['id'],*row])
    return Response(content="\ufeff"+buffer.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="xps-{payload.kind}.csv"'})
