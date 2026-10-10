"""基于原谱的静态背景；实际能量步长积分，升降序结果一致。"""
import numpy as np
from scipy.integrate import cumulative_trapezoid

from .xps_schemas import XpsRequest


def prepare_data(request: XpsRequest):
    raw = np.asarray(request.x, dtype=float)
    y = np.asarray(request.y, dtype=float)
    order = np.argsort(raw)
    raw, y = raw[order], y[order]
    if np.any(np.diff(raw) <= 0):
        raise ValueError("能量点重复；请先明确重复测量的合并方式")
    x = raw + request.shift_eV
    lo = request.range_start if request.range_start is not None else x[0]
    hi = request.range_end if request.range_end is not None else x[-1]
    mask = (x >= lo) & (x <= hi)
    if mask.sum() < 3:
        raise ValueError("拟合区间至少需要 3 个不同能量点")
    return x[mask], y[mask], raw[mask]


def preview_background(request: XpsRequest):
    x, y, raw = prepare_data(request)
    cfg = request.background
    meta = {"kind": cfg.kind, "iterations": 0, "converged": True, "static": True}
    if cfg.kind == "none":
        baseline = np.zeros_like(y)
    else:
        def level(explicit, window, low):
            if explicit is not None:
                return float(explicit)
            if window is None:
                raise ValueError("请设置两端背景水平或端点窗口，并复核背景预览")
            a, b = window
            if a > b or a < x[0] or b > x[-1]:
                raise ValueError("背景端点窗口必须位于实际拟合区间内")
            selected = y[(x >= a) & (x <= b)]
            if selected.size == 0:
                raise ValueError("背景端点窗口内没有数据")
            return float(np.median(selected))

        low = level(cfg.low_level, cfg.low_window, True)
        high = level(cfg.high_level, cfg.high_window, False)
        if cfg.low_window and cfg.high_window and cfg.low_window[1] > cfg.high_window[0]:
            raise ValueError("低能端与高能端窗口不能交叉")
        meta.update(low_level=low, high_level=high)
        baseline = low + (high-low)*(x-x[0])/(x[-1]-x[0])
        if cfg.kind == "shirley":
            scale = max(float(np.ptp(y)), abs(high-low), 1.0)
            for iteration in range(1, cfg.max_iterations+1):
                integral = cumulative_trapezoid(y-baseline, x, initial=0)
                if not np.isfinite(integral[-1]) or integral[-1] <= np.finfo(float).eps*scale*(x[-1]-x[0])*100:
                    raise ValueError("Shirley 净信号积分非正或过小，请复核端点与背景模型")
                updated = low + (high-low)*integral/integral[-1]
                error = float(np.max(np.abs(updated-baseline))) / scale
                baseline = updated
                if error <= cfg.tolerance:
                    meta.update(iterations=iteration, relative_change=error)
                    break
            else:
                raise ValueError("Shirley 背景未收敛；请调整区间、端点或迭代设置")
    if not np.all(np.isfinite(baseline)):
        raise ValueError("背景计算产生非有限值")
    return {"x": x.tolist(), "x_raw": raw.tolist(), "raw_y": y.tolist(),
            "baseline": baseline.tolist(), "background": meta,
            "configuration": cfg.model_dump(mode="json")}
