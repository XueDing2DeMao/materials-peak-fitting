"""XPS 背景适配与候选峰检测，数值核心与通用多峰共用。"""
import numpy as np
from scipy.signal import find_peaks, peak_widths
from .xps_backgrounds import preview_background
from .multipeak_core import fit_components


def fit_xps(request):
    if request.background.kind == "shirley" and not request.background.confirmed:
        raise ValueError("请先预览并复核 Shirley 背景，再进行拟合")
    warnings = ["已移动能量轴，但未填写校准依据"] if request.shift_eV and not request.calibration_note.strip() else []
    return fit_components(request, preview_background(request), extra_warnings=warnings,
                          uncertainty_note="标准误仅在当前固定背景、模型及约束下成立，不含背景选择与能量校准误差")


def suggest_candidates(request):
    preview = preview_background(request)
    x = np.asarray(preview["x"])
    net = np.asarray(preview["raw_y"])-preview["baseline"]
    indices, properties = find_peaks(net, prominence=max(float(np.ptp(net))*.03, np.finfo(float).eps))
    widths, _, left, right = peak_widths(net, indices, rel_height=.5)
    order = np.argsort(properties["prominences"])[::-1][:20]
    candidates = []
    for j in order:
        i = indices[j]
        w = float(np.interp(right[j], np.arange(len(x)), x)-np.interp(left[j], np.arange(len(x)), x))
        candidates.append({"xc": float(x[i]), "w": max(w, float(np.min(np.diff(x)))),
                           "A": max(float(net[i]), 0)*w*1.2, "mu": .35,
                           "prominence": float(properties["prominences"][j])})
    return {"candidates": candidates, "note": "仅提供局部极大值初值；峰数及化学态须人工判断"}
