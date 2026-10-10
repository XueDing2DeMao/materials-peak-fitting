"""固定背景上的面积归一化多峰拟合与条件不确定度诊断。"""
import hashlib

import numpy as np
from scipy.optimize import least_squares
from scipy.signal import find_peaks, peak_widths
from scipy.special import erf

from .peaks import evaluate_peak
from .peak_properties import peak_geometry
from .xps_backgrounds import preview_background
from .xps_constraints import ParameterGraph


def fit_xps(request):
    if request.background.kind == "shirley" and not request.background.confirmed:
        raise ValueError("请先预览并复核 Shirley 背景，再进行拟合")
    preview = preview_background(request)
    x, y, baseline = [np.asarray(preview[k]) for k in ("x", "raw_y", "baseline")]
    components = [c for c in request.components if c.enabled]
    if not components:
        raise ValueError("至少启用一个峰分量")
    graph = ParameterGraph(request, x)
    n, k = len(x), len(graph.free)
    if n <= k:
        raise ValueError("区间数据点数必须大于独立自由参数个数")

    def curves(q):
        values = graph.values(q)
        return [evaluate_peak(c.model, x, {p: values[c.id, p] for p in c.parameters}) for c in components]

    def residual(q):
        return baseline + np.sum(curves(q), axis=0) - y

    if k:
        opt = least_squares(residual, graph.initial, bounds=(graph.lower, graph.upper), method="trf",
                            x_scale="jac", max_nfev=request.solver.max_nfev,
                            ftol=request.solver.tolerance, xtol=request.solver.tolerance,
                            gtol=request.solver.tolerance)
        q, converged, message, nfev = opt.x, bool(opt.success), str(opt.message), int(opt.nfev)
        active = set(np.flatnonzero(opt.active_mask))
        for i, value in enumerate(q):
            tolerance = 1e-6 * max(1, abs(value))
            if value-graph.lower[i] <= tolerance or graph.upper[i]-value <= tolerance:
                active.add(i)
    else:
        q, converged, message, nfev, active = np.array([]), True, "所有参数固定；仅计算模型与残差", 0, set()
    ys = curves(q)
    total = baseline + np.sum(ys, axis=0)
    # 残差统一定义为原始观测减模型。
    res = y-total
    rss = float(res @ res)
    variance = rss/(n-k)
    net = y-baseline
    tss = float(np.sum((net-net.mean())**2))
    cov, rank, condition = None, k, None
    correlations = []
    if k:
        scales = np.linalg.norm(opt.jac, axis=0)
        scaled = opt.jac / np.where(scales > 0, scales, 1)
        _, singular, vt = np.linalg.svd(scaled, full_matrices=False)
        rank = int(np.sum(singular > singular[0]*1e-7)) if singular[0] else 0
        condition = float(singular[0]/singular[-1]) if singular[-1] > 0 else None
        if rank == k:
            cov = (vt.T * (variance/singular**2)) @ vt
            cov /= np.outer(scales, scales)
            se = np.sqrt(np.maximum(np.diag(cov), 0))
            for i in range(k):
                for j in range(i):
                    if se[i]*se[j] > 0:
                        rho = float(np.clip(cov[i,j]/(se[i]*se[j]), -1, 1))
                        if abs(rho) >= .95:
                            correlations.append({"a": ".".join(graph.free[i]), "b": ".".join(graph.free[j]), "correlation": rho})
    identifiable = rank == k
    warnings = []
    if not converged: warnings.append("优化未收敛，当前数值不能作为最终拟合结果")
    if not identifiable: warnings.append("雅可比秩不足，部分峰无法独立辨识；不报告标准误")
    if active: warnings.append("存在贴边参数；相关参数的线性标准误不可用")
    if correlations: warnings.append("存在强参数相关（|r| ≥ 0.95）；请检查峰数、区间及初值敏感性")
    if graph.initial_clipped: warnings.append("部分独立初值超出传播后边界，已投影到可行边界")
    if request.shift_eV and not request.calibration_note.strip(): warnings.append("已移动能量轴，但未填写校准依据")
    warnings.append("标准误仅在当前固定背景、模型及约束下成立，不含背景选择与能量校准误差")
    values, output = graph.values(q), []
    free_index = {key: i for i, key in enumerate(graph.free)}
    weak_tail_roots = set()
    for c in components:
        if c.model in ('emg_high','emg_low') and values[c.id,'tau']/values[c.id,'sigma'] < 1e-3 and graph.expanded[c.id,'tau'][0] in free_index:
            for name in ('sigma','tau'):
                root = graph.expanded[c.id,name][0]
                if root in free_index: weak_tail_roots.add(root)
    if weak_tail_roots:
        warnings.append('EMG 接近 Gaussian 极限（弱尾）；相关宽度和尾尺度不报告线性标准误')
    window_areas = []
    for c, curve in zip(components, ys):
        params = {}
        for name in c.parameters:
            key = (c.id, name)
            root, a, _ = graph.expanded[key]
            idx = free_index.get(root)
            reason = ("固定参数" if idx is None else "优化未收敛" if not converged else
                      "秩不足" if cov is None else "贴边参数" if idx in active else
                      "弱尾接近 Gaussian 极限" if root in weak_tail_roots else None)
            lo, hi = graph.bounds[key]
            params[name] = {"value": values[key], "standard_error": None if reason else float(abs(a)*np.sqrt(max(cov[idx,idx],0))),
                            "uncertainty_reason": reason, "fixed": idx is None, "bound": idx in active,
                            "linked_to": ".".join(root) if key in graph.links else None,
                            "lower": float(lo) if np.isfinite(lo) else None, "upper": float(hi) if np.isfinite(hi) else None}
        parameter_values = {p:values[c.id,p] for p in c.parameters}
        geometry = peak_geometry(c.model,parameter_values,float(x[0]),float(x[-1]))
        a, xc = values[c.id,'A'], values[c.id,'xc']
        w = geometry['fwhm']
        if c.model in ('gaussian','lorentz','psd_voigt1'):
            # 保留既有导出字段的计算口径和浮点结果。
            w=values[c.id,'w']
            mu=values.get((c.id,'mu'),1. if c.model=='lorentz' else 0.)
            low,high=x[0]-xc,x[-1]-xc
            gf=.5*(erf(np.sqrt(4*np.log(2))*high/w)-erf(np.sqrt(4*np.log(2))*low/w))
            lf=(np.arctan(2*high/w)-np.arctan(2*low/w))/np.pi
            area_window=float(a*((1-mu)*gf+mu*lf))
        else:
            area_window=geometry['area_in_range']
            if area_window is None:raise ValueError(f"峰 {c.id} 区间面积计算失败")
        window_areas.append(area_window)
        output.append({"id": c.id, "label": c.label or c.id, "model": c.model, "parameters": params,
                       "area_total": a, "area_window": area_window, "fwhm": w,
                       "height": float(evaluate_peak(c.model, np.array([xc]), {p: values[c.id,p] for p in c.parameters})[0]),
                       "y": curve.tolist(), "peak_geometry":geometry})
    area_sum = sum(window_areas)
    for c in output:
        c["area_fraction_window"] = c["area_window"]/area_sum if area_sum > 0 else None
    groups = []
    for g in request.groups:
        selected = [c for c in output if c["id"] in g.component_ids]
        groups.append({**g.model_dump(), "area_total": sum(c["area_total"] for c in selected),
                       "area_window": sum(c["area_window"] for c in selected),
                       "area_fraction_window": sum(c["area_window"] for c in selected)/area_sum if area_sum > 0 else None})
    lag = None
    if np.std(res[:-1]) > 0 and np.std(res[1:]) > 0:
        lag = float(np.corrcoef(res[:-1], res[1:])[0,1])
    if lag is not None and abs(lag) > .5:
        warnings.append("残差具有明显相邻相关性；收敛和高 R² 不代表模型适用")
    result = {**preview, "configuration": request.model_dump(mode="json"), "components": output, "groups": groups,
              "total_y": total.tolist(), "net_total": np.sum(ys, axis=0).tolist(), "residuals": res.tolist(), "converged": converged,
              "solver": "scipy.least_squares / TRF", "message": message, "evaluations": nfev,
              "data_sha256": hashlib.sha256(np.asarray([request.x, request.y], dtype="<f8").tobytes()).hexdigest(),
              "statistics": {"points": n, "free_parameters": k, "degrees_of_freedom": n-k, "rss": rss,
                             "rmse": float(np.sqrt(rss/n)), "residual_variance": variance,
                             "r_squared": 1-rss/tss if tss > 0 else None,
                             "aic": float(n*np.log(rss/n)+2*k) if rss > 0 else None,
                             "aicc": float(n*np.log(rss/n)+2*k+2*k*(k+1)/(n-k-1)) if rss > 0 and n > k+1 else None,
                             "durbin_watson": float(np.sum(np.diff(res)**2)/rss) if rss > 0 else None,
                             "residual_mean": float(res.mean()), "residual_standard_deviation": float(res.std(ddof=1)),
                             "bic": float(n*np.log(rss/n)+k*np.log(n)) if rss > 0 else None},
              "diagnostics": {"identifiable": identifiable, "jacobian_rank": rank, "scaled_condition": condition,
                              "bound_parameters": [".".join(graph.free[i]) for i in sorted(active)],
                              "strong_correlations": correlations, "lag1_correlation": lag,
                              "uncertainty_available": converged and identifiable and not active and not weak_tail_roots and k > 0,
                              "warnings": warnings}}
    return result


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
