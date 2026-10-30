"""有诊断的线性回归，供 WH 与标样校准共用。"""
import numpy as np

from .errors import CalculationError
from .units import finite


def linear_regression(x, y, minimum=3):
    if len(x) != len(y) or len(x) < minimum:
        raise CalculationError('INSUFFICIENT_POINTS', f'至少需要 {minimum} 个有效点')
    x = np.asarray([finite(v) for v in x], dtype=float)
    y = np.asarray([finite(v) for v in y], dtype=float)
    if len(np.unique(x)) < minimum:
        raise CalculationError('RANK_DEFICIENT', f'至少需要 {minimum} 个不同的横坐标')
    centered = x - np.mean(x)
    scale = float(np.max(np.abs(centered)))
    if scale == 0 or not np.isfinite(scale):
        raise CalculationError('RANK_DEFICIENT', '回归横坐标没有可辨识变化')
    design = np.column_stack((np.ones(len(x)), centered / scale))
    coefficients, _, rank, _ = np.linalg.lstsq(design, y, rcond=None)
    if rank != 2:
        raise CalculationError('RANK_DEFICIENT', '线性回归不满秩')
    slope = finite(float(coefficients[1] / scale))
    intercept = finite(float(coefficients[0] - slope * np.mean(x)))
    prediction = slope * x + intercept
    residuals = y - prediction
    rss = finite(float(np.sum(residuals ** 2)))
    tss = float(np.sum((y - np.mean(y)) ** 2))
    return {'slope': slope, 'intercept': intercept, 'residuals': residuals.tolist(),
            'predicted': prediction.tolist(), 'rss': rss, 'r_squared': 1-rss/tss if tss > 0 else None,
            'n': len(x), 'uncertainty': '首期未传播输入不确定度；回归指标不是材料测量精度'}
