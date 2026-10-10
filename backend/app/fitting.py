"""Bounded, auditable nonlinear fitting for one peak over a fixed baseline."""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from math import log
from typing import Mapping

import numpy as np
from numpy.typing import NDArray
from scipy.optimize import least_squares
from scipy.signal import find_peaks, peak_widths, savgol_filter
from scipy.stats import t as student_t

from .baselines import Anchor, build_baseline
from .peaks import ASYMMETRIC_MODELS, evaluate_peak, model_parameter_names
from .peak_properties import peak_geometry


SUPPORTED_COMPARISON_MODELS = ("gaussian", "lorentz", "psd_voigt1", "psd_voigt2")


@dataclass(slots=True)
class FitInput:
    x: NDArray[np.float64]
    y: NDArray[np.float64]
    model: str
    baseline_kind: str
    anchors: list[Anchor]
    degree: int = 2
    smoothing: float = 0.0
    range_start: float | None = None
    range_end: float | None = None
    initial_parameters: Mapping[str, float] = field(default_factory=dict)
    parameter_bounds: Mapping[str, tuple[float | None, float | None]] = field(default_factory=dict)
    fixed_parameters: Mapping[str, float] = field(default_factory=dict)
    anchor_source: str = "manual"
    baseline_confirmed: bool = True
    staged_fit: bool = True
    center_lock_evaluations: int = 20
    max_function_evaluations: int = 2000
    tolerance: float = 1e-8


@dataclass(slots=True)
class ParameterEstimate:
    value: float
    standard_error: float | None
    confidence_interval: tuple[float, float] | None
    lower_bound: float | None
    upper_bound: float | None
    fixed: bool
    uncertainty_reason: str | None = None


@dataclass(slots=True)
class FitStatistics:
    r_squared: float
    adjusted_r_squared: float | None
    rmse: float
    sse: float
    points: int
    free_parameters: int
    degrees_of_freedom: int
    reduced_chi_square: float | None
    residual_mean: float
    residual_standard_deviation: float
    durbin_watson: float | None
    outlier_count: int
    has_trend: bool


@dataclass(slots=True)
class AutoPeakAnalysis:
    """Reproducible automatic starting estimates for the single-peak workflow."""

    initial_parameters: dict[str, float]
    candidate_count: int
    selected_index: int
    prominence: float
    smoothing_window: int
    method: str
    warnings: list[str] = field(default_factory=list)


@dataclass(slots=True)
class FitResult:
    x: NDArray[np.float64]
    raw_y: NDArray[np.float64]
    baseline: NDArray[np.float64]
    net_y: NDArray[np.float64]
    peak_y: NDArray[np.float64]
    total_y: NDArray[np.float64]
    residual: NDArray[np.float64]
    parameters: dict[str, ParameterEstimate]
    statistics: FitStatistics
    converged: bool
    message: str
    model: str
    range_start: float
    range_end: float
    baseline_configuration: dict[str, float | str]
    solver: str
    iterations: int
    covariance_matrix: list[list[float]] | None
    correlation_matrix: list[list[float]] | None
    derived_parameters: dict[str, float]
    analysis_metadata: dict[str, str]
    fit_stages: list[dict[str, str | int | float | bool]]
    peak_geometry: dict


@dataclass(slots=True)
class ModelComparison:
    active_model: str
    recommended_model: str | None
    rows: list[dict[str, str | float | bool | None]]


def _fwhm_estimate(x: NDArray[np.float64], y: NDArray[np.float64], maximum_index: int) -> float:
    height = y[maximum_index]
    half_height = height / 2
    left = np.where(y[:maximum_index] <= half_height)[0]
    right = np.where(y[maximum_index + 1 :] <= half_height)[0]
    if left.size and right.size:
        return float(x[maximum_index + 1 + right[0]] - x[left[-1]])
    return float((x[-1] - x[0]) / 5)


def _detection_smoothing_window(points: int) -> int:
    """Use a small odd Savitzky-Golay window without smoothing away a narrow peak."""
    if points < 7:
        return 0
    proposed = max(7, min(51, (points // 40) * 2 + 1))
    maximum = points if points % 2 else points - 1
    return min(proposed, maximum)


def analyze_single_peak(request: FitInput) -> AutoPeakAnalysis:
    """Locate the dominant positive, baseline-subtracted peak and derive physical initial values."""
    x, y, baseline, _ = preview_fixed_baseline(request)
    net_y = y - baseline
    window = _detection_smoothing_window(len(net_y))
    smoothed = savgol_filter(net_y, window_length=window, polyorder=min(3, window - 1)) if window else net_y
    signal_floor = float(np.quantile(smoothed, 0.1))
    signal_span = float(np.max(smoothed) - signal_floor)
    noise = float(np.median(np.abs(np.diff(smoothed))) * 1.4826) if len(smoothed) > 1 else 0.0
    minimum_prominence = max(signal_span * 0.03, noise * 4, np.finfo(float).eps)
    candidates, properties = find_peaks(smoothed, prominence=minimum_prominence)
    if candidates.size:
        selected_offset = int(np.argmax(properties["prominences"]))
        maximum_index = int(candidates[selected_offset])
        prominence = float(properties["prominences"][selected_offset])
    else:
        maximum_index = int(np.argmax(smoothed))
        prominence = max(0.0, float(smoothed[maximum_index] - signal_floor))
    width = _fwhm_estimate(x, smoothed - signal_floor, maximum_index)
    if candidates.size:
        widths, _, left_ips, right_ips = peak_widths(smoothed - signal_floor, [maximum_index], rel_height=0.5)
        if widths[0] > 0:
            positions = np.arange(len(x), dtype=float)
            width = float(np.interp(right_ips[0], positions, x) - np.interp(left_ips[0], positions, x))
    span = float(x[-1] - x[0])
    width = max(width, span / max(1000, len(x)), np.finfo(float).eps)
    area = max(float(np.trapz(np.clip(net_y, 0, None), x)), np.finfo(float).eps)
    initial_parameters = {"A": area, "xc": float(x[maximum_index]), "w": width, "wG": width, "wL": width, "mu": 0.5,
                          "h_low":width/2,"h_high":width/2,"sigma":width/2.354820045,"tau":width/2.354820045*.25}
    if request.model == 'split_psd_voigt':
        initial_parameters.update(_split_half_estimates(x,smoothed-signal_floor,maximum_index,width))
    warnings=[]
    if request.model in ASYMMETRIC_MODELS:
        half=(smoothed[maximum_index]-signal_floor)/2
        for label,side in [('低 X',smoothed[:maximum_index]-signal_floor),('高 X',smoothed[maximum_index+1:]-signal_floor)]:
            if not np.any(side<=half):warnings.append(f'{label} 侧未观测到半高点，初始宽度使用估计值；请复核区间截断')
    return AutoPeakAnalysis(
        initial_parameters={name: initial_parameters[name] for name in model_parameter_names(request.model)},
        candidate_count=max(1, int(candidates.size)), selected_index=maximum_index, prominence=prominence,
        smoothing_window=window, method="Savitzky-Golay smoothing + prominence peak detection", warnings=warnings,
    )


def _split_half_estimates(x, y, maximum_index, width):
    half=y[maximum_index]/2
    left=np.where(y[:maximum_index]<=half)[0]
    right=np.where(y[maximum_index+1:]<=half)[0]
    low=width/2;high=width/2
    if left.size:
        i=left[-1];cross=np.interp(half,[y[i],y[i+1]],[x[i],x[i+1]])
        low=max(float(x[maximum_index]-cross),np.finfo(float).eps)
    if right.size:
        i=maximum_index+1+right[0];cross=np.interp(half,[y[i],y[i-1]],[x[i],x[i-1]])
        high=max(float(cross-x[maximum_index]),np.finfo(float).eps)
    return {'h_low':low,'h_high':high}


def _initial_values(
    model: str,
    x: NDArray[np.float64],
    net_y: NDArray[np.float64],
    overrides: Mapping[str, float],
    bound_overrides: Mapping[str, tuple[float | None, float | None]],
    fixed_parameters: Mapping[str, float],
) -> tuple[list[str], NDArray[np.float64], NDArray[np.float64], NDArray[np.float64]]:
    names = list(model_parameter_names(model))
    span = float(x[-1] - x[0])
    if span <= 0:
        raise ValueError("拟合范围内的 X 值必须递增")
    maximum_index = int(np.argmax(net_y))
    width = max(_fwhm_estimate(x, net_y, maximum_index), span / max(1000, len(x)), np.finfo(float).eps)
    area = max(float(np.trapz(np.clip(net_y, 0, None), x)), np.finfo(float).eps)
    default = {"A": area, "xc": float(x[maximum_index]), "w": width, "wG": width, "wL": width, "mu": 0.5,
               **_split_half_estimates(x,net_y,maximum_index,width),"sigma":width/2.354820045,"tau":width/2.354820045*.25}
    values = np.asarray([float(overrides.get(name, default[name])) for name in names], dtype=float)
    eps = max(span * 1e-12, np.finfo(float).eps)
    # Only the physical domain is implicit. Origin-style user bounds are applied below.
    lower_values = {"A": eps, "xc": -np.inf, "w": eps, "wG": eps, "wL": eps, "mu": 0.0,"h_low":eps,"h_high":eps,"sigma":eps,"tau":0.}
    upper_values = {name:1. if name=='mu' else np.inf for name in lower_values}
    lower = np.asarray([lower_values[name] for name in names], dtype=float)
    upper = np.asarray([upper_values[name] for name in names], dtype=float)

    unknown = (set(overrides) | set(bound_overrides) | set(fixed_parameters)) - set(names)
    if unknown:
        raise ValueError(f"峰函数不包含参数：{', '.join(sorted(unknown))}")
    for index, name in enumerate(names):
        requested_lower, requested_upper = bound_overrides.get(name, (None, None))
        if requested_lower is not None:
            if not np.isfinite(requested_lower):
                raise ValueError(f"{name} 的下限必须是有限数值")
            lower[index] = max(lower[index], float(requested_lower))
        if requested_upper is not None:
            if not np.isfinite(requested_upper):
                raise ValueError(f"{name} 的上限必须是有限数值")
            upper[index] = min(upper[index], float(requested_upper))
        if lower[index] >= upper[index]:
            raise ValueError(f"{name} 的参数上下限无效")
    finite_lower = np.where(np.isfinite(lower), lower + eps, -np.inf)
    finite_upper = np.where(np.isfinite(upper), upper - eps, np.inf)
    values = np.clip(values, finite_lower, finite_upper)
    for index, name in enumerate(names):
        if name not in fixed_parameters:
            continue
        value = float(fixed_parameters[name])
        if not np.isfinite(value) or not lower[index] <= value <= upper[index]:
            raise ValueError(f"固定参数 {name} 必须位于有效边界内")
    return names, values, lower, upper


def _covariance_and_errors(
    jacobian: NDArray[np.float64], sse: float, degrees_of_freedom: int
) -> tuple[NDArray[np.float64] | None, NDArray[np.float64] | None]:
    if degrees_of_freedom <= 0:
        return None, None
    try:
        covariance = np.linalg.pinv(jacobian.T @ jacobian) * (sse / degrees_of_freedom)
        return covariance, np.sqrt(np.clip(np.diag(covariance), 0, None))
    except np.linalg.LinAlgError:
        return None, None


def _to_lm_space(name: str, value: float) -> float:
    """Map constrained physical parameters to an unbounded LM coordinate."""
    if name in {"A", "w", "wG", "wL"}:
        return float(np.log(value))
    if name == "mu":
        clipped = float(np.clip(value, 1e-12, 1 - 1e-12))
        return float(np.log(clipped / (1 - clipped)))
    return value


def _from_lm_space(name: str, value: float) -> tuple[float, float]:
    """Return a physical parameter and d(physical)/d(LM coordinate)."""
    if name in {"A", "w", "wG", "wL"}:
        physical = float(np.exp(np.clip(value, -700, 700)))
        return physical, physical
    if name == "mu":
        physical = float(1 / (1 + np.exp(-np.clip(value, -700, 700))))
        return physical, physical * (1 - physical)
    return value, 1.0


def _correlation_from_covariance(covariance: NDArray[np.float64] | None) -> list[list[float]] | None:
    if covariance is None:
        return None
    standard_errors = np.sqrt(np.clip(np.diag(covariance), 0, None))
    denominator = np.outer(standard_errors, standard_errors)
    with np.errstate(divide="ignore", invalid="ignore"):
        correlation = np.divide(covariance, denominator, out=np.full_like(covariance, np.nan), where=denominator > 0)
    # 零方差下相关系数不可定义；用既有 nullable 字段表示，避免响应含 NaN。
    return correlation.tolist() if np.all(np.isfinite(correlation)) else None


def _residual_diagnostics(
    x: NDArray[np.float64], residual: NDArray[np.float64]
) -> tuple[float, float, float | None, int, bool]:
    """Summarise residual behaviour without promoting it to a pass/fail verdict."""
    mean = float(np.mean(residual))
    standard_deviation = float(np.std(residual, ddof=1)) if len(residual) > 1 else 0.0
    squared_sum = float(np.sum(residual**2))
    durbin_watson = (
        float(np.sum(np.diff(residual) ** 2) / squared_sum)
        if squared_sum > np.finfo(float).eps
        else None
    )
    if standard_deviation <= np.finfo(float).eps:
        return mean, standard_deviation, durbin_watson, 0, False
    standardized = (residual - mean) / standard_deviation
    outlier_count = int(np.count_nonzero(np.abs(standardized) > 3))
    correlation = float(np.corrcoef(x, residual)[0, 1]) if np.std(x) > np.finfo(float).eps else 0.0
    return mean, standard_deviation, durbin_watson, outlier_count, bool(np.isfinite(correlation) and abs(correlation) >= 0.3)


def preview_fixed_baseline(
    request: FitInput,
) -> tuple[NDArray[np.float64], NDArray[np.float64], NDArray[np.float64], list[Anchor]]:
    """Return the selected data and its fixed baseline for review before peak optimization."""
    x = np.asarray(request.x, dtype=float)
    y = np.asarray(request.y, dtype=float)
    if x.shape != y.shape or x.ndim != 1:
        raise ValueError("X 和 Y 必须是长度一致的一维数组")
    if not np.all(np.isfinite(x)) or not np.all(np.isfinite(y)):
        raise ValueError("X 和 Y 必须都是有限数值")

    ordered = np.argsort(x, kind="stable")
    x, y = x[ordered], y[ordered]
    start = float(request.range_start) if request.range_start is not None else float(x[0])
    end = float(request.range_end) if request.range_end is not None else float(x[-1])
    if not start < end:
        raise ValueError("拟合范围的起点必须小于终点")
    selected = (x >= start) & (x <= end)
    x, y = x[selected], y[selected]
    if len(x) < 4:
        raise ValueError("拟合范围内至少需要四个数据点")
    if np.any(np.diff(x) <= 0):
        raise ValueError("拟合范围内的 X 值不能重复")

    anchors = request.anchors
    if request.baseline_kind in {"line", "constant"} and not anchors:
        window = max(1, int(np.ceil(len(x) * 0.05)))
        anchors = [Anchor(float(x[0]), float(np.median(y[:window]))), Anchor(float(x[-1]), float(np.median(y[-window:])))]
    baseline = build_baseline(request.baseline_kind, x, anchors, request.degree, request.smoothing)
    return x, y, baseline, anchors


def fit_single_peak(request: FitInput) -> FitResult:
    """Fit one bounded peak after evaluating, but never optimizing, its baseline."""
    if request.anchor_source == "suggested" and not request.baseline_confirmed:
        raise ValueError("建议的基线锚点尚未复核；请确认或手动编辑后再拟合")
    if request.max_function_evaluations < 1:
        raise ValueError("最大函数评估次数必须至少为 1")
    if request.center_lock_evaluations < 0:
        raise ValueError("中心固定阶段的函数评估次数不能为负数")
    if not 0 < request.tolerance < 1:
        raise ValueError("收敛阈值必须大于 0 且小于 1")
    names_for_staging = model_parameter_names(request.model)
    if request.staged_fit and "xc" in names_for_staging and "xc" not in request.fixed_parameters and request.center_lock_evaluations:
        automatic = analyze_single_peak(request)
        prepared_initial = {**automatic.initial_parameters, **request.initial_parameters}
        locked_center = float(prepared_initial["xc"])
        prefit = fit_single_peak(
            replace(
                request,
                initial_parameters=prepared_initial,
                fixed_parameters={**request.fixed_parameters, "xc": locked_center},
                staged_fit=False,
                max_function_evaluations=request.center_lock_evaluations,
            )
        )
        release_initial = {name: estimate.value for name, estimate in prefit.parameters.items()}
        final = fit_single_peak(
            replace(request, initial_parameters=release_initial, staged_fit=False)
        )
        final.fit_stages = [
            {
                "name": "中心固定预拟合", "center_fixed": True, "evaluations": prefit.iterations,
                "converged": prefit.converged, "initial_center": locked_center,
            },
            {
                "name": "中心释放收敛", "center_fixed": False, "evaluations": final.iterations,
                "converged": final.converged, "initial_center": prefit.parameters["xc"].value,
            },
        ]
        final.analysis_metadata = {
            **final.analysis_metadata,
            "initialization": automatic.method,
            "automatic_candidates": str(automatic.candidate_count),
            "staged_fit": "fixed center pre-fit followed by released-center convergence",
            **({'initialization_warning':'；'.join(automatic.warnings)} if automatic.warnings else {}),
        }
        return final
    x, y, baseline, anchors = preview_fixed_baseline(request)
    net_y = y - baseline
    names, initial, lower, upper = _initial_values(
        request.model, x, net_y, request.initial_parameters, request.parameter_bounds, request.fixed_parameters
    )
    fixed = {name: float(value) for name, value in request.fixed_parameters.items()}
    free_names = [name for name in names if name not in fixed]
    free_indices = [names.index(name) for name in free_names]
    free_initial = initial[free_indices]
    free_lower = lower[free_indices]
    free_upper = upper[free_indices]

    def values_to_parameters(values: NDArray[np.float64]) -> dict[str, float]:
        parameters = fixed.copy()
        parameters.update(zip(free_names, values, strict=True))
        return parameters

    def residual_for(values: NDArray[np.float64]) -> NDArray[np.float64]:
        return evaluate_peak(request.model, x, values_to_parameters(values)) - net_y

    if free_names:
        if len(x) < len(free_names):
            raise ValueError("拟合数据点数量必须不少于自由参数数量")
        uses_finite_user_bounds = any(
            lower_bound is not None or upper_bound is not None
            for lower_bound, upper_bound in request.parameter_bounds.values()
        )
        if uses_finite_user_bounds or request.model in ASYMMETRIC_MODELS:
            optimization = least_squares(
                residual_for, x0=free_initial, bounds=(free_lower, free_upper), method="trf",
                max_nfev=request.max_function_evaluations, ftol=request.tolerance, xtol=request.tolerance, gtol=request.tolerance,
            )
            optimized_parameters = values_to_parameters(optimization.x)
            jacobian = optimization.jac
            solver = "Trust Region Reflective (bounded)"
        else:
            lm_initial = np.asarray([_to_lm_space(name, value) for name, value in zip(free_names, free_initial, strict=True)])

            def lm_residual(lm_values: NDArray[np.float64]) -> NDArray[np.float64]:
                physical_values = np.asarray(
                    [_from_lm_space(name, value)[0] for name, value in zip(free_names, lm_values, strict=True)]
                )
                return residual_for(physical_values)

            optimization = least_squares(
                lm_residual, x0=lm_initial, method="lm", max_nfev=request.max_function_evaluations,
                ftol=request.tolerance, xtol=request.tolerance, gtol=request.tolerance,
            )
            physical_values_and_derivatives = [
                _from_lm_space(name, value) for name, value in zip(free_names, optimization.x, strict=True)
            ]
            optimized_parameters = values_to_parameters(
                np.asarray([value for value, _ in physical_values_and_derivatives], dtype=float)
            )
            derivatives = np.asarray([derivative for _, derivative in physical_values_and_derivatives], dtype=float)
            jacobian = optimization.jac / derivatives
            solver = "Levenberg-Marquardt"
        converged, message = bool(optimization.success), str(optimization.message)
        iterations = int(optimization.nfev)
    else:
        optimized_parameters = fixed
        converged, message, jacobian = True, "所有峰参数均已固定", np.empty((len(x), 0))
        solver, iterations = "Fixed parameters only", 0
    peak_y = evaluate_peak(request.model, x, optimized_parameters)
    total_y = baseline + peak_y
    residual = y - total_y
    residual_mean, residual_standard_deviation, durbin_watson, outlier_count, has_trend = _residual_diagnostics(x, residual)
    sse = float(np.sum(residual**2))
    ss_total = float(np.sum((net_y - np.mean(net_y)) ** 2))
    r_squared = 1.0 if ss_total == 0 and sse == 0 else (1 - sse / ss_total if ss_total else 0.0)
    degrees_of_freedom = len(x) - len(free_names)
    adjusted = 1 - (1 - r_squared) * (len(x) - 1) / degrees_of_freedom if degrees_of_freedom > 0 else None
    covariance, errors = _covariance_and_errors(jacobian, sse, degrees_of_freedom)
    uncertainty_reason = None
    if request.model in ASYMMETRIC_MODELS and free_names:
        scales=np.linalg.norm(jacobian,axis=0)
        singular=np.linalg.svd(jacobian/np.where(scales>0,scales,1),compute_uv=False)
        rank=int(np.sum(singular>singular[0]*1e-7)) if singular.size and singular[0] else 0
        # 宽度的诊断随 X 单位缩放；峰位采用区间跨度，避免大坐标偏置。
        bound_scales=[float(x[-1]-x[0]) if name=='xc' else 1. if name=='mu' else max(abs(value),np.finfo(float).tiny)
                      for name,value in zip(free_names,optimization.x)]
        on_bound=any(value-lo<=1e-6*scale or hi-value<=1e-6*scale
                     for value,lo,hi,scale in zip(optimization.x,free_lower,free_upper,bound_scales))
        weak_tail=request.model.startswith('emg_') and optimized_parameters['tau']/optimized_parameters['sigma']<1e-3 and 'tau' in free_names
        uncertainty_reason=('优化未收敛' if not converged else '雅可比秩不足，参数不能独立辨识' if rank<len(free_names) else
                            '存在贴边参数，线性协方差不适用' if on_bound else '拖尾接近高斯极限，sigma/tau 难以独立辨识' if weak_tail else None)
        if uncertainty_reason:covariance,errors=None,None
    ci_multiplier = float(student_t.ppf(0.975, degrees_of_freedom)) if degrees_of_freedom > 0 else None
    parameters = {
        name: ParameterEstimate(
            optimized_parameters[name],
            None if name in fixed or errors is None else float(errors[free_names.index(name)]),
            None
            if name in fixed or errors is None or ci_multiplier is None
            else (
                float(optimized_parameters[name] - ci_multiplier * errors[free_names.index(name)]),
                float(optimized_parameters[name] + ci_multiplier * errors[free_names.index(name)]),
            ),
            request.parameter_bounds.get(name, (None, None))[0],
            request.parameter_bounds.get(name, (None, None))[1],
            name in fixed,
            '固定参数' if name in fixed else uncertainty_reason,
        )
        for name in names
    }
    peak_height = float(evaluate_peak(request.model, np.asarray([optimized_parameters["xc"]]), optimized_parameters)[0])
    derived_parameters = {
        "area_total": float(optimized_parameters["A"]),
        "area_in_range": float(np.trapz(peak_y, x)),
        "peak_height": peak_height,
    }
    for name in ("w", "wG", "wL"):
        if name in optimized_parameters:
            derived_parameters[f"{name}_fwhm"] = float(optimized_parameters[name])
    return FitResult(
        x=x,
        raw_y=y,
        baseline=baseline,
        net_y=net_y,
        peak_y=peak_y,
        total_y=total_y,
        residual=residual,
        parameters=parameters,
        statistics=FitStatistics(
            r_squared=r_squared,
            adjusted_r_squared=adjusted,
            rmse=float(np.sqrt(np.mean(residual**2))),
            sse=sse,
            points=len(x),
            free_parameters=len(free_names),
            degrees_of_freedom=degrees_of_freedom,
            reduced_chi_square=sse / degrees_of_freedom if degrees_of_freedom > 0 else None,
            residual_mean=residual_mean,
            residual_standard_deviation=residual_standard_deviation,
            durbin_watson=durbin_watson,
            outlier_count=outlier_count,
            has_trend=has_trend,
        ),
        converged=converged,
        message=message,
        model=request.model,
        range_start=float(x[0]),
        range_end=float(x[-1]),
        baseline_configuration={
            "kind": request.baseline_kind,
            "degree": request.degree,
            "smoothing": request.smoothing,
            "anchor_count": len(anchors),
            "anchor_source": request.anchor_source,
            "baseline_confirmed": str(request.baseline_confirmed).lower(),
        },
        solver=solver,
        iterations=iterations,
        covariance_matrix=None if covariance is None else covariance.tolist(),
        correlation_matrix=_correlation_from_covariance(covariance),
        derived_parameters=derived_parameters,
        analysis_metadata={
            "workflow": "fixed-baseline-subtracted single positive peak",
            "offset": "y0 fixed at 0 after baseline subtraction",
            "weighting": "none (unweighted least squares)",
            **({'uncertainty_warning':uncertainty_reason} if uncertainty_reason else {}),
        },
        fit_stages=[{
            "name": "单阶段拟合", "center_fixed": "xc" in fixed, "evaluations": iterations,
            "converged": converged,
        }],
        peak_geometry=peak_geometry(request.model, optimized_parameters, float(x[0]), float(x[-1])),
    )


def compare_single_peak_models(request: FitInput, include_asymmetric: bool = False) -> ModelComparison:
    """Compare supported peak profiles on one unchanged baseline and analysis range."""
    rows: list[dict[str, str | float | bool | None]] = []
    for model in SUPPORTED_COMPARISON_MODELS + (ASYMMETRIC_MODELS if include_asymmetric else ()):
        names = set(model_parameter_names(model))
        comparable_request = replace(
            request,
            model=model,
            initial_parameters={name: value for name, value in request.initial_parameters.items() if name in names},
            parameter_bounds={name: value for name, value in request.parameter_bounds.items() if name in names},
            fixed_parameters={name: value for name, value in request.fixed_parameters.items() if name in names},
        )
        try:
            result = fit_single_peak(comparable_request)
        except ValueError as exc:
            rows.append({"model": model, "converged": False, "r_squared": None, "rmse": None, "aicc": None, "bic": None, "message": str(exc)})
            continue
        points = result.statistics.points
        free_parameters = result.statistics.free_parameters
        mean_sse = max(result.statistics.sse / points, np.finfo(float).tiny)
        aic = points * log(mean_sse) + 2 * free_parameters
        aicc = aic + 2 * free_parameters * (free_parameters + 1) / (points - free_parameters - 1) if points > free_parameters + 1 else None
        bic = points * log(mean_sse) + free_parameters * log(points)
        rows.append({
            "model": model,
            "converged": result.converged,
            "r_squared": result.statistics.r_squared,
            "rmse": result.statistics.rmse,
            "aicc": aicc,
            "bic": bic,
            "message": result.message,
        })
    candidates = [row for row in rows if row["converged"] and isinstance(row["aicc"], float)]
    recommended_model = min(candidates, key=lambda row: float(row["aicc"]))["model"] if candidates else None
    return ModelComparison(active_model=request.model, recommended_model=str(recommended_model) if recommended_model else None, rows=rows)
