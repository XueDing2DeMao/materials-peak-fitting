"""Explicit anchor-based baseline functions for single-peak fitting."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from scipy.interpolate import CubicSpline, UnivariateSpline


BaselineKind = Literal["none", "constant", "line", "polynomial", "spline", "bspline"]


@dataclass(frozen=True, slots=True)
class Anchor:
    x: float
    y: float


def _validated_anchors(anchors: list[Anchor]) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    if not anchors:
        raise ValueError("请至少添加两个基线锚点")
    ordered = sorted(anchors, key=lambda anchor: anchor.x)
    xs = np.asarray([anchor.x for anchor in ordered], dtype=float)
    ys = np.asarray([anchor.y for anchor in ordered], dtype=float)
    if not np.all(np.isfinite(xs)) or not np.all(np.isfinite(ys)):
        raise ValueError("基线锚点必须是有限数值")
    if np.any(np.diff(xs) == 0):
        raise ValueError("基线锚点的 X 值不能重复")
    return xs, ys


def build_baseline(
    kind: BaselineKind | str,
    x: NDArray[np.float64],
    anchors: list[Anchor],
    degree: int = 2,
    smoothing: float = 0.0,
) -> NDArray[np.float64]:
    """Evaluate one declared baseline across ``x`` from user-owned anchors."""
    points = np.asarray(x, dtype=float)
    if points.size == 0:
        raise ValueError("没有可计算基线的 X 数据")
    if kind == "none":
        return np.zeros_like(points)
    anchor_x, anchor_y = _validated_anchors(anchors)

    if kind == "constant":
        return np.full_like(points, float(np.mean(anchor_y)))
    if kind == "line":
        if len(anchor_x) < 2:
            raise ValueError("直线基线至少需要两个锚点")
        slope, intercept = np.polyfit(anchor_x[[0, -1]], anchor_y[[0, -1]], 1)
        return slope * points + intercept
    if kind == "polynomial":
        if not 1 <= degree <= 8:
            raise ValueError("多项式阶数必须在 1 到 8 之间")
        if len(anchor_x) < degree + 1:
            raise ValueError(f"{degree} 阶多项式至少需要 {degree + 1} 个锚点")
        return np.polyval(np.polyfit(anchor_x, anchor_y, degree), points)
    if kind == "spline":
        if len(anchor_x) < 3:
            raise ValueError("Spline 基线至少需要三个锚点")
        interpolated = CubicSpline(anchor_x, anchor_y, extrapolate=False)(points)
        # Cubic extrapolation from internal anchors is numerically unconstrained and can create a false baseline.
        return np.where(points < anchor_x[0], anchor_y[0], np.where(points > anchor_x[-1], anchor_y[-1], interpolated))
    if kind == "bspline":
        if len(anchor_x) < 4:
            raise ValueError("B-Spline 基线至少需要四个锚点")
        if smoothing < 0:
            raise ValueError("B-Spline 平滑强度不能小于 0")
        return UnivariateSpline(anchor_x, anchor_y, k=min(3, len(anchor_x) - 1), s=smoothing, ext=3)(points)
    raise ValueError(f"不支持的基线类型：{kind}")
