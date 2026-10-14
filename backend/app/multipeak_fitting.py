"""通用／XRD 多峰的固定基线准备与初值建议。"""
import numpy as np
from scipy.signal import find_peaks, peak_widths
from .baselines import Anchor
from .fitting import FitInput, preview_fixed_baseline
from .multipeak_core import fit_components, validate_components


def preview_multipeak(request):
    b = request.baseline
    x, y, baseline, anchors = preview_fixed_baseline(FitInput(
        x=np.asarray(request.x), y=np.asarray(request.y), model='gaussian', baseline_kind=b.kind,
        anchors=[Anchor(a.x, a.y) for a in b.anchors], degree=b.degree, smoothing=b.smoothing,
        range_start=request.range_start, range_end=request.range_end))
    return dict(x=x.tolist(), raw_y=y.tolist(), baseline=baseline.tolist(),
                baseline_configuration={**b.model_dump(), 'resolved_anchors':[dict(x=a.x,y=a.y) for a in anchors]})


def fit_multipeak(request):
    preview = preview_multipeak(request)
    if request.baseline.kind != 'none' and not request.baseline.confirmed:
        raise ValueError('请先预览并复核当前基线')
    result = fit_components(request, preview)
    result['statistics_definition'] = {'r_squared': '扣除固定基线后的观测信号', 'residuals': '原始观测减总拟合'}
    result['computed_only'] = result['statistics']['free_parameters'] == 0
    return result


def validate_multipeak(request):
    preview=preview_multipeak(request)
    validate_components(request,preview)
    return preview


def suggest_multipeak(request):
    preview = preview_multipeak(request)
    x = np.asarray(preview['x'])
    net = np.asarray(preview['raw_y'])-preview['baseline']
    indices, props = find_peaks(net, prominence=max(float(np.ptp(net))*.03,np.finfo(float).eps))
    _, _, left, right = peak_widths(net, indices, rel_height=.5)
    candidates=[]
    for j in np.argsort(props['prominences'])[::-1][:20]:
        width=max(float(np.interp(right[j],np.arange(len(x)),x)-np.interp(left[j],np.arange(len(x)),x)),float(np.min(np.diff(x))))
        candidates.append(dict(xc=float(x[indices[j]]), w=width, A=max(float(net[indices[j]]),0)*width*1.2, mu=.35, prominence=float(props['prominences'][j])))
    return {'candidates':candidates,'note':'局部极大值仅用于初值；重叠峰的峰数需人工判断。'}
