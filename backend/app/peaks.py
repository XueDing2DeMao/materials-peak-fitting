"""Origin-compatible, area-normalized single-peak profile functions."""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np
from numpy.typing import NDArray
from .asymmetric import emg_logpdf, emg_mode


MODEL_PARAMETERS: dict[str, tuple[str, ...]] = {
    "gaussian": ("A", "xc", "w"),
    "lorentz": ("A", "xc", "w"),
    "psd_voigt1": ("A", "xc", "w", "mu"),
    "psd_voigt2": ("A", "xc", "wG", "wL", "mu"),
    "split_psd_voigt": ("A", "xc", "h_low", "h_high", "mu"),
    "emg_high": ("A", "xc", "sigma", "tau"),
    "emg_low": ("A", "xc", "sigma", "tau"),
}

ASYMMETRIC_MODELS = ("split_psd_voigt", "emg_high", "emg_low")


def model_parameter_names(model: str) -> tuple[str, ...]:
    """Return ordered, public parameter names for a supported peak model."""
    try:
        return MODEL_PARAMETERS[model]
    except KeyError as exc:
        raise ValueError(f"不支持的峰函数：{model}") from exc


def _positive(value: float, name: str = "宽度") -> float:
    result = float(value)
    if not np.isfinite(result) or result <= 0:
        raise ValueError(f"{name}必须是正数")
    return result


def _mixture(value: float) -> float:
    result = float(value)
    if not np.isfinite(result) or not 0 <= result <= 1:
        raise ValueError("mu 必须在 0 到 1 之间")
    return result


def gaussian(x: NDArray[np.float64], A: float, xc: float, w: float) -> NDArray[np.float64]:
    """Gaussian profile with area ``A`` and full width at half maximum ``w``."""
    w = _positive(w)
    points = np.asarray(x, dtype=float)
    return A * np.sqrt(4 * np.log(2)) / (np.sqrt(np.pi) * w) * np.exp(-4 * np.log(2) * ((points - xc) / w) ** 2)


def lorentz(x: NDArray[np.float64], A: float, xc: float, w: float) -> NDArray[np.float64]:
    """Lorentz profile with area ``A`` and full width at half maximum ``w``."""
    w = _positive(w)
    points = np.asarray(x, dtype=float)
    return (2 * A / np.pi) * w / (4 * (points - xc) ** 2 + w**2)


def psd_voigt1(x: NDArray[np.float64], A: float, xc: float, w: float, mu: float) -> NDArray[np.float64]:
    """Pseudo-Voigt mixture using one shared FWHM for both components."""
    mu = _mixture(mu)
    return mu * lorentz(x, A, xc, w) + (1 - mu) * gaussian(x, A, xc, w)


def psd_voigt2(
    x: NDArray[np.float64], A: float, xc: float, wG: float, wL: float, mu: float
) -> NDArray[np.float64]:
    """Pseudo-Voigt mixture using independent Gaussian and Lorentzian FWHM."""
    mu = _mixture(mu)
    return mu * lorentz(x, A, xc, wL) + (1 - mu) * gaussian(x, A, xc, wG)


def evaluate_peak(model: str, x: NDArray[np.float64], params: Mapping[str, float]) -> NDArray[np.float64]:
    """Evaluate one supported profile from its named parameter mapping."""
    names = model_parameter_names(model)
    missing = [name for name in names if name not in params]
    if missing:
        raise ValueError(f"峰函数缺少参数：{', '.join(missing)}")

    values = {name: float(params[name]) for name in names}
    if model == "gaussian":
        return gaussian(x, **values)
    if model == "lorentz":
        return lorentz(x, **values)
    if model == "psd_voigt1":
        return psd_voigt1(x, **values)
    if model == "psd_voigt2":
        return psd_voigt2(x, **values)
    if model == "split_psd_voigt":
        low, high = _positive(values['h_low']), _positive(values['h_high'])
        mu = _mixture(values['mu'])
        offset = np.asarray(x,dtype=float)-values['xc']
        u = offset/np.where(offset<=0,low,high)
        q = (1-mu)*np.sqrt(np.log(2)/np.pi)*np.exp(-np.log(2)*u*u)+mu/(np.pi*(1+u*u))
        return 2*values['A']/(low+high)*q
    if model in ('emg_high','emg_low'):
        sigma = _positive(values['sigma'],'sigma')
        tau = values['tau']
        if not np.isfinite(tau) or tau<0:
            raise ValueError('tau 必须为有限非负数')
        k = tau/sigma
        sign = 1 if model == 'emg_high' else -1
        t = sign*(np.asarray(x,dtype=float)-values['xc'])/sigma+emg_mode(k)
        with np.errstate(under='ignore'):
            return values['A']/sigma*np.exp(emg_logpdf(t,k))
    raise ValueError(f'不支持的峰函数：{model}')
