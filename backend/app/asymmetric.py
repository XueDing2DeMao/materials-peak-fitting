"""峰顶居中的 EMG 标准化内核，使用稳定尾部计算。"""
from functools import lru_cache

import numpy as np
from scipy.optimize import brentq
from scipy.special import erfc, erfcx, log_ndtr, ndtr


def emg_logpdf(t, k):
    t = np.asarray(t,dtype=float)
    if k < 1e-8:
        # 峰顶居中后形状误差为 O(k²)，低于双精度；避免 1/k 的溢出。
        return -.5*(t-k)**2-.5*np.log(2*np.pi)
    a = (1/k-t)/np.sqrt(2)
    result = np.empty_like(t)
    positive = a >= 0
    # 远尾的下溢对应零密度；不能让中间 exp 与 erfc 溢出互相抵消。
    with np.errstate(over='ignore',under='ignore',divide='ignore'):
        result[positive] = -np.log(2*k)-.5*t[positive]**2+np.log(erfcx(a[positive]))
        if np.any(~positive):
            result[~positive] = -np.log(2*k)+.5/k**2-t[~positive]/k+np.log(erfc(a[~positive]))
    return result


@lru_cache(maxsize=512)
def emg_mode(k: float) -> float:
    if not np.isfinite(k) or k < 0:
        raise ValueError('EMG 尾尺度与高斯宽度之比必须为有限非负数')
    if k < 1e-3:
        # 众数渐近展开；在此范围截断误差小于 4e-15 个 sigma。
        return k-k**3
    def score(t):
        a=(1/k-t)/np.sqrt(2)
        if a>=0:
            log_hazard=.5*np.log(2/np.pi)-np.log(erfcx(a))
        else:
            z=-np.sqrt(2)*a
            log_hazard=-z*z/2-.5*np.log(2*np.pi)-log_ndtr(z)
        return log_hazard+np.log(k)
    high=max(1.,np.sqrt(2*np.log1p(k))+1)
    return float(brentq(score,0.,high,xtol=1e-13))


def emg_interval(low: float, high: float, k: float) -> float:
    if k < 1e-8:
        low-=k;high-=k
        return float(ndtr(-low)-ndtr(-high) if low>0 else ndtr(high)-ndtr(low))
    def sf(t):
        return float(ndtr(-t)+np.exp(np.log(k)+emg_logpdf(t,k)))
    def cdf(t):
        log_normal=float(log_ndtr(t))
        log_ratio=min(0.,float(np.log(k)+emg_logpdf(t,k))-log_normal)
        return float(np.exp(log_normal)*(-np.expm1(log_ratio)))
    return sf(low)-sf(high) if low>0 else cdf(high)-cdf(low)
