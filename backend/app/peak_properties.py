"""单个净峰的连续模型性质，与观测点密度及绘图方向无关。"""
from collections.abc import Mapping

import numpy as np
from scipy.optimize import brentq
from scipy.special import ndtr

from .peaks import evaluate_peak
from .asymmetric import emg_interval, emg_logpdf, emg_mode


def _normal_interval(low, high):
    return float(ndtr(-low)-ndtr(-high) if low > 0 else ndtr(high)-ndtr(low))


def area_fraction(model: str, p: Mapping[str, float], low: float, high: float) -> float:
    """单位面积模型在有限区间内的积分。"""
    lo, hi = sorted((low-p['xc'], high-p['xc']))
    if model in ('gaussian', 'lorentz', 'psd_voigt1', 'psd_voigt2'):
        wg = p.get('wG', p.get('w', 1.))
        wl = p.get('wL', p.get('w', 1.))
        mu = 0. if model == 'gaussian' else 1. if model == 'lorentz' else p['mu']
        gaussian = _normal_interval(lo*np.sqrt(8*np.log(2))/wg, hi*np.sqrt(8*np.log(2))/wg)
        lorentz = float((np.arctan(2*hi/wl)-np.arctan(2*lo/wl))/np.pi)
        return (1-mu)*gaussian + mu*lorentz
    if model == 'split_psd_voigt':
        def segment(a,b,h):
            normal=_normal_interval(a*np.sqrt(2*np.log(2))/h,b*np.sqrt(2*np.log(2))/h)
            lorentz=(np.arctan(b/h)-np.arctan(a/h))/np.pi
            return 2*h/(p['h_low']+p['h_high'])*((1-p['mu'])*normal+p['mu']*lorentz)
        return (segment(lo,min(hi,0.),p['h_low']) if lo<0 else 0.)+(segment(max(lo,0.),hi,p['h_high']) if hi>0 else 0.)
    if model in ('emg_high','emg_low'):
        k=p['tau']/p['sigma'];mode=emg_mode(k)
        if model=='emg_low':lo,hi=-hi,-lo
        return emg_interval(lo/p['sigma']+mode,hi/p['sigma']+mode,k)
    raise ValueError(f'尚未定义模型积分：{model}')


def half_widths(model: str, p: Mapping[str, float]) -> tuple[float, float]:
    if model == 'split_psd_voigt':
        return p['h_low'],p['h_high']
    if model in ('emg_high','emg_low'):
        k=p['tau']/p['sigma'];mode=emg_mode(k)
        height=float(emg_logpdf(mode,k))
        def root(sign):
            def fn(d):return float(emg_logpdf(mode+sign*d,k))-height+np.log(2)
            high=max(1.,k) if sign>0 else 1.
            for _ in range(100):
                if fn(high)<=0:break
                high*=2
            else:raise ValueError('EMG 半高交点未能括定')
            return brentq(fn,0.,high,xtol=1e-13)*p['sigma']
        widths=(root(-1),root(1))
        return widths if model=='emg_high' else widths[::-1]
    if model in ('gaussian', 'lorentz', 'psd_voigt1'):
        return p['w']/2, p['w']/2
    if model == 'psd_voigt2':
        wg, wl, mu = p['wG'], p['wL'], p['mu']
        if wg == wl or mu == 0:
            return wg/2, wg/2
        if mu == 1:
            return wl/2, wl/2
        # 标准化后求根，避免大峰位、小宽度时的坐标相减误差。
        scale = max(wg, wl)
        normalized = {**p, 'A':1., 'xc':0., 'wG':wg/scale, 'wL':wl/scale}
        height = evaluate_peak(model, np.array([0.]), normalized)[0]
        def residual(t):return evaluate_peak(model,np.array([t]),normalized)[0]/height-.5
        lower,upper=min(wg,wl)/(2*scale),.5
        # 先接受满足半高精度的端点，避免 log/exp 往返使近纯分量的根落在括区间外。
        if abs(residual(lower))<=1e-12:root=lower
        elif abs(residual(upper))<=1e-12:root=upper
        else:
            root=np.exp(brentq(lambda log_t: residual(np.exp(log_t)),np.log(lower),np.log(upper),xtol=1e-13))
        if abs(evaluate_peak(model,np.array([root]),normalized)[0]/height-.5)>1e-8:
            raise ValueError('整体半高宽未达到数值精度要求')
        return root*scale, root*scale
    raise ValueError(f'尚未定义模型半高宽：{model}')


def peak_geometry(model: str, p: Mapping[str, float], low: float, high: float) -> dict:
    low, high = sorted((float(low), float(high)))
    fields = ('peak_position','peak_height','fwhm','hwhm_low','hwhm_high','halfmax_low','halfmax_high',
              'area_total','area_in_range','area_fraction_in_range')
    result = {key:None for key in fields}
    result.update(range_start=low, range_end=high, halfmax_within_range=None, reasons={}, warnings=[],
                  area_method='模型积分（解析原函数/CDF）', width_method='连续模型半高交点',
                  uncertainty_note='派生量未计算标准误；全域面积包含区间外模型外推')
    area = float(p['A'])
    result['area_total'] = area
    if area == 0:
        result.update(area_in_range=0., peak_height=0.)
        result['reasons'] = {key:'峰面积为零，无有效峰顶或比例' for key in fields if result[key] is None}
        return result
    try:
        fraction = area_fraction(model,p,low,high)
        if not np.isfinite(fraction) or not -1e-12 <= fraction <= 1+1e-12:
            raise ValueError('模型积分未得到有效面积比例')
        result.update(area_in_range=area*fraction, area_fraction_in_range=fraction)
    except (ValueError, FloatingPointError, OverflowError) as exc:
        for key in ('area_in_range','area_fraction_in_range'): result['reasons'][key]=str(exc)
    try:
        height = float(evaluate_peak(model,np.array([p['xc']]),p)[0])
        if not np.isfinite(height) or height <= 0:
            raise ValueError('未得到有限的正峰高')
        result.update(peak_position=float(p['xc']),peak_height=height)
        left, right = half_widths(model,p)
        if not np.all(np.isfinite([left,right])) or min(left,right)<=0:
            raise ValueError('未找到有效半高交点')
        xlo, xhi = float(p['xc']-left), float(p['xc']+right)
        result.update(fwhm=float(left+right), hwhm_low=float(left), hwhm_high=float(right),
                      halfmax_low=xlo,halfmax_high=xhi,halfmax_within_range=bool(low<=xlo and xhi<=high))
        if not result['halfmax_within_range']:
            result['warnings'].append('半高点位于数据区间外，宽度依赖外推')
    except (ValueError, FloatingPointError, OverflowError, RuntimeError) as exc:
        for key in fields:
            if result[key] is None and key not in result['reasons']: result['reasons'][key]=str(exc)
    return result


def geometry_rows(geometry: dict):
    """CSV 使用独立名字、单位口径和缺失原因，避免混淆旧采样积分。"""
    for key, value in geometry.items():
        if key in ('reasons','warnings'): continue
        unit = 'Y 单位 × X 单位' if key in ('area_total','area_in_range') else (
            'Y 单位' if key == 'peak_height' else '无量纲' if key == 'area_fraction_in_range' else
            'X 单位' if key in ('peak_position','fwhm','hwhm_low','hwhm_high','halfmax_low','halfmax_high','range_start','range_end') else '')
        yield [f'geometry.{key}',value,unit,geometry.get('reasons',{}).get(key,'')]
    for warning in geometry.get('warnings',[]): yield ['geometry.warning',warning,'','']
