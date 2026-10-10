"""复算手册使用的公开实谱；不推断化学态，不依赖历史分析目录。"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from app.datasets import parse_upload, select_xy
from app.fitting import FitInput, analyze_single_peak, fit_single_peak
from app.main import fit_result_to_dict, export
from app.schemas import ExportPayload
from app.xps_fitting import fit_xps
from app.xps_schemas import XpsRequest
from app.xps_routes import XpsExport, export_xps

BASE = Path(__file__).resolve().parent
DATA = BASE / "zenodo_18845748"
OUT = BASE / "results"


def save(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def main():
    OUT.mkdir(exist_ok=True)
    manifest = json.loads((DATA / "source.json").read_text(encoding="utf-8"))
    for f in manifest["files"]:
        assert hashlib.sha256((DATA / f["file"]).read_bytes()).hexdigest() == f["sha256"], f["file"]
    summaries = []
    for name, filename, sheet, xcol, ycol, interval in [
        ("raman", "Raman.xlsx", "Bare Ge", "Wavenumber", "Pristine #1", (280, 320)),
        ("xrd", "XRD.xlsx", "BareGe", "2Theta", "Pristine Ge", (65.8, 66.6)),
    ]:
        book = parse_upload(filename, (DATA / filename).read_bytes())
        x, y = select_xy(book, sheet, xcol, ycol)
        request = FitInput(x=x, y=y, model="psd_voigt1", baseline_kind="line", anchors=[],
                           range_start=interval[0], range_end=interval[1], anchor_source="endpoint_default")
        request.initial_parameters = analyze_single_peak(request).initial_parameters
        result = fit_result_to_dict(fit_single_peak(request))
        assert result["converged"], name
        source = {"file": filename, "sheet": sheet, "x_column": xcol, "y_column": ycol,
                  "requested_range": list(interval), "valid_full_spectrum_points": len(x),
                  "selected_points": len(result["x"]), "selection_reason": "手册演示单峰操作所选的单条原谱与局部峰区；非总体统计",
                  "preprocessing": "数值化、去除无效配对行、按 X 排序；未平滑、未归一化、未合并重复测量",
                  "model": "psd_voigt1", "baseline_kind": "line", "anchors": [], "anchor_source": "endpoint_default",
                  "initial_parameters": request.initial_parameters}
        save(name + "-result.json", {"source": source, "result": result})
        for kind in ("curves", "parameters"):
            (OUT / f"{name}-{kind}.csv").write_bytes(export(ExportPayload(kind=kind, result=result)).body)
        summaries.append({"case": name, **source, "parameters": {k: v["value"] for k, v in result["parameters"].items()},
                          "r_squared": result["statistics"]["r_squared"], "rmse": result["statistics"]["rmse"]})

    config = json.loads((BASE / "xps-ge2p-configuration.json").read_text(encoding="utf-8"))["request"]
    p = DATA / config["source"]["filename"]
    assert hashlib.sha256(p.read_bytes()).hexdigest() == config["source"]["file_sha256"]
    book = parse_upload(p.name, p.read_bytes())
    x, y = select_xy(book, config["source"]["sheet"], config["source"]["x_column"], config["source"]["y_column"])
    assert x.tolist() == config["x"] and y.tolist() == config["y"]
    # 配置文件保留未复核状态；复算使用明确给出的背景端点和教学约束。
    config["background"]["confirmed"] = True
    request = XpsRequest.model_validate(config)
    result = fit_xps(request)
    assert result["converged"]
    save("xps-result.json", result)
    for kind in ("curves", "parameters"):
        (OUT / f"xps-{kind}.csv").write_bytes(export_xps(XpsExport(kind=kind, request=request)).body)
    summaries.append({"case": "xps", "source": config["source"], "range": [config["range_start"], config["range_end"]],
                      "valid_full_spectrum_points": len(x), "selected_points": len(result["x"]),
                      "statistics": result["statistics"], "diagnostics": result["diagnostics"],
                      "interpretation": "两组探索性双峰，仅演示配置和约束；保留结构化残差，不确认化学态"})
    save("summary.json", summaries)
    print(json.dumps(summaries, ensure_ascii=True, indent=2))


if __name__ == "__main__":
    main()
