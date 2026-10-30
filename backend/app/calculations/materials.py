"""明确适用范围的材料参数模板，失败保留原因而不填零。"""
from __future__ import annotations

import math
import numpy as np

from .errors import CalculationError
from .regression import linear_regression
from .units import Quantity, convert, finite, parse_unit


def required_text(config, key, label):
    value = config.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise CalculationError('MISSING_CONTEXT', f'请提供{label}', key)
    return value.strip()


def quantity_value(value, target, label):
    if not isinstance(value, dict):
        raise CalculationError('MISSING_VALUE', f'缺少{label}')
    return convert(value.get('value'), value.get('unit', 'unknown'), target)


def field(record, name):
    value = record.get('fields', {}).get(name)
    if not isinstance(value, dict):
        raise CalculationError('MISSING_VALUE', f'缺少峰字段 {name}', f'fields.{name}')
    finite(value.get('value'), name)
    return value


def positive(value, name):
    result = finite(value, name)
    if result <= 0:
        raise CalculationError('NONPOSITIVE_VALUE', f'{name}必须为正')
    return result


def value(number, unit, definition=None):
    return {'value': finite(number), 'unit': unit, **({'definition': definition} if definition else {})}


def wavelength(config):
    return positive(quantity_value(config.get('wavelength'), 'nm', '辐射波长'), '辐射波长')


def theta(record):
    position = field(record, 'position')
    if position.get('definition') != 'two_theta':
        raise CalculationError('POSITION_DEFINITION', 'XRD 计算要求峰位明确定义为 2θ', 'fields.position.definition')
    angle = convert(position['value'], position.get('unit', 'unknown'), 'rad') / 2
    if not 0 < angle < math.pi / 2:
        raise CalculationError('ANGLE_RANGE', '2θ 必须在 0° 与 180° 之间')
    return angle


def hkl(values, label='hkl'):
    if not isinstance(values, (list, tuple)) or len(values) != 3 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or int(v) != v or abs(v) > 100 for v in values):
        raise CalculationError('INVALID_HKL', f'{label}必须是三个绝对值不超过 100 的整数')
    if all(v == 0 for v in values):
        raise CalculationError('INVALID_HKL', f'{label}不能全部为零')
    return tuple(int(v) for v in values)


def lattice(record, config):
    lam, angle = wavelength(config), theta(record)
    d = lam / (2 * math.sin(angle))
    values, warnings = {'d': value(d, 'nm', 'd_spacing')}, []
    crystal = config.get('crystal_system')
    overrides = config.get('hkl_by_record') or {}
    if not isinstance(overrides, dict):
        raise CalculationError('INVALID_HKL', '逐峰 hkl 必须按记录 ID 提供')
    indices = overrides.get(record.get('id'), config.get('hkl'))
    if indices is None:
        indices = record.get('metadata', {}).get('hkl')
    if indices is not None: indices = hkl(indices)
    if crystal not in (None, '', 'cubic'):
        raise CalculationError('UNSUPPORTED_CRYSTAL', '首期只支持已知立方晶系；其他晶系不自动套用立方公式')
    if crystal == 'cubic' and indices is not None:
        values['a'] = value(d * math.sqrt(sum(v*v for v in indices)), 'nm', 'cubic_lattice_parameter')
    else:
        warnings.append('未同时指定立方晶系和 hkl，仅计算晶面间距 d')
    return values, warnings, {'theta_rad': angle, 'wavelength_nm': lam, 'hkl': indices, 'order': 1}


def corrected_width(record, config, angle, for_wh=False):
    width = field(record, 'width')
    if width.get('definition') != 'fwhm':
        raise CalculationError('WIDTH_DEFINITION', '模板要求 2θ 轴上的整体 FWHM，不能代用 sigma 或未知宽度')
    measured = convert(width['value'], width.get('unit', 'unknown'), 'rad')
    if measured <= 0:
        raise CalculationError('NONPOSITIVE_WIDTH', '峰宽必须为正')
    correction = config.get('correction')
    if not isinstance(correction, dict):
        raise CalculationError('MISSING_CORRECTION', '请选择有依据的展宽校正方式，或显式选择未校正表观值')
    mode = correction.get('mode')
    if mode not in ('gaussian', 'lorentz', 'corrected', 'apparent'):
        raise CalculationError('MISSING_CORRECTION', '未知展宽校正方式')
    if for_wh and mode not in ('lorentz', 'corrected'):
        raise CalculationError('PROFILE_MISMATCH', 'WH 模板只接受 Lorentz 型线性校正或已有来源的校正宽度')
    details = {'correction_mode': mode, 'measured_fwhm_rad': measured, 'width_definition': 'fwhm_2theta'}
    if mode == 'apparent':
        if record.get('metadata', {}).get('width_corrected'):
            raise CalculationError('CORRECTION_MISMATCH', '已校正宽度不能标为未校正表观值')
        return measured, ['未扣除仪器展宽：此值仅为表观尺寸，不能作为已校正尺寸'], details, True
    details['correction_source'] = required_text(correction, 'source', '展宽校正来源')
    if correction.get('conditions_match') is not True:
        raise CalculationError('CONDITIONS_MISMATCH', '须确认测量条件、宽度口径与仪器标样相容')
    if mode == 'corrected':
        if correction.get('instrument_width') is not None or correction.get('instrument_table'):
            raise CalculationError('DOUBLE_CORRECTION', '已校正宽度不能再次提供仪器宽度相减')
        return measured, [], details, False
    if record.get('metadata', {}).get('width_corrected') is True:
        raise CalculationError('DOUBLE_CORRECTION', '记录已经校正，不能重复扣除仪器展宽')
    model = str(record.get('model', '')).lower()
    expected = {'gaussian': {'gaussian', 'gauss'}, 'lorentz': {'lorentz', 'lorentzian', 'cauchy'}}[mode]
    if model not in expected:
        raise CalculationError('PROFILE_MISMATCH', '所选校正仅适用于相同纯峰形；混合或未知峰形须提供有来源的已校正宽度')
    direct, table = correction.get('instrument_width'), correction.get('instrument_table')
    if direct is not None and table:
        raise CalculationError('AMBIGUOUS_CORRECTION', '同角度宽度和仪器宽度表只能选择一种')
    if table:
        if not isinstance(table, list) or not 2 <= len(table) <= 1000:
            raise CalculationError('INSTRUMENT_TABLE', '仪器宽度表需要 2—1000 个点')
        positions, widths = [], []
        for row in table:
            if not isinstance(row, dict): raise CalculationError('INSTRUMENT_TABLE', '仪器宽度表的每行须含 position 与 width')
            positions.append(convert(row.get('position'), correction.get('position_unit', 'deg'), 'rad'))
            widths.append(convert(row.get('width'), correction.get('width_unit', 'deg'), 'rad'))
        if any(v < 0 for v in widths) or any(not 0 < v < math.pi for v in positions):
            raise CalculationError('INSTRUMENT_TABLE', '仪器宽度不得为负，角度必须在 0°—180°')
        order = np.argsort(positions); positions = np.asarray(positions)[order]; widths = np.asarray(widths)[order]
        if np.any(np.diff(positions) <= 0):
            raise CalculationError('INSTRUMENT_TABLE', '仪器宽度表不能包含重复角度')
        if not positions[0] <= 2 * angle <= positions[-1]:
            raise CalculationError('INSTRUMENT_RANGE', '峰位超出仪器标准表范围，禁止外推')
        instrument = float(np.interp(2 * angle, positions, widths))
        details['instrument_interpolated'] = True
    else:
        instrument = quantity_value(direct, 'rad', '同角度仪器 FWHM')
    if instrument < 0:
        raise CalculationError('NONPOSITIVE_WIDTH', '仪器 FWHM 不能为负')
    difference = measured ** 2 - instrument ** 2 if mode == 'gaussian' else measured - instrument
    if difference <= 0:
        raise CalculationError('NONPOSITIVE_WIDTH', '校正后展宽非正，无法辨识有效尺寸')
    beta = math.sqrt(difference) if mode == 'gaussian' else difference
    details['instrument_fwhm_rad'] = instrument
    return beta, [], details, False


def scherrer(record, config):
    lam, angle = wavelength(config), theta(record)
    k = positive(config.get('K'), 'K'); source = required_text(config, 'K_source', 'K 的来源及形状假设')
    beta, warnings, details, apparent = corrected_width(record, config, angle)
    size = k * lam / (beta * math.cos(angle))
    warnings.append('Scherrer 结果为所选峰及形状假设下的相干衍射域尺寸估计，不等同显微组织晶粒尺寸')
    details.update(K=k, K_source=source, wavelength_nm=lam, theta_rad=angle, beta_sample_rad=beta)
    return {'D': value(size, 'nm', 'apparent_scherrer_size' if apparent else 'scherrer_coherent_domain_size'),
            'beta_sample': value(beta, 'rad', 'fwhm_2theta')}, warnings, details, apparent


def relative_strain(record, config):
    measured_hkl = hkl(config.get('hkl'), '测量 hkl')
    reference_hkl = hkl(config.get('reference_hkl'), '参考 hkl')
    meta = record.get('metadata', {})
    if measured_hkl != reference_hkl or (meta.get('hkl') is not None and hkl(meta['hkl']) != measured_hkl):
        raise CalculationError('REFERENCE_MISMATCH', '测量与参考必须对应相同晶面')
    source = required_text(config, 'reference_source', '无应力参考来源')
    if config.get('conditions_match') is not True:
        raise CalculationError('CONDITIONS_MISMATCH', '须确认无应力参考和测量条件相容')
    d0 = positive(quantity_value(config.get('d0'), 'nm', '参考 d0'), '参考 d0')
    if config.get('measured_d') is not None:
        d = positive(quantity_value(config['measured_d'], 'nm', '测量 d'), '测量 d')
    else:
        d = wavelength(config) / (2 * math.sin(theta(record)))
    strain = (d - d0) / d0
    return {'d': value(d, 'nm', 'd_spacing'), 'd0': value(d0, 'nm', 'stress_free_d_spacing'),
            'strain': value(strain, '1', 'relative_lattice_strain'),
            'strain_percent': value(strain * 100, '%', 'relative_lattice_strain'),
            'microstrain': value(strain * 1e6, 'microstrain', 'relative_lattice_strain')}, \
           ['这是指定晶面的相对间距变化，不是完整应力张量或 WH 展宽微应变'], \
           {'reference_source': source, 'hkl': measured_hkl, 'measurement_conditions_confirmed': True}


def williamson_hall(records, config):
    if len(records) < 3:
        raise CalculationError('INSUFFICIENT_PEAKS', 'WH 至少需要三个同相、不同角度的有效峰')
    if config.get('profile') != 'lorentz' or config.get('isotropic') is not True:
        raise CalculationError('WH_ASSUMPTIONS', '须确认 Lorentz 型线性展宽和各向同性假设')
    phase = required_text(config, 'phase', 'WH 同一物相名称')
    if any(r.get('metadata', {}).get('phase') not in (None, '', phase) for r in records):
        raise CalculationError('PHASE_MISMATCH', 'WH 选峰包含不同物相，不能合并回归')
    definitions = {field(r, 'width').get('definition') for r in records}
    if definitions != {'fwhm'}:
        raise CalculationError('WIDTH_DEFINITION', 'WH 需要统一 FWHM 定义')
    conditions = {str(r.get('metadata', {}).get('measurement_conditions')) for r in records if r.get('metadata', {}).get('measurement_conditions')}
    if len(conditions) > 1:
        raise CalculationError('CONDITIONS_MISMATCH', 'WH 选峰的测量条件不一致')
    lam, k = wavelength(config), positive(config.get('K'), 'K')
    required_text(config, 'K_source', 'K 的来源及形状假设')
    points = []
    for record in records:
        angle = theta(record)
        beta, _, correction, _ = corrected_width(record, config, angle, for_wh=True)
        points.append({'record_id': record['id'], 'two_theta_deg': math.degrees(2 * angle),
                       'beta_sample_rad': beta, 'x': 4 * math.sin(angle), 'y': beta * math.cos(angle),
                       'correction': correction})
    diagnostics = linear_regression([p['x'] for p in points], [p['y'] for p in points])
    diagnostics.update(points=points, phase=phase, assumption='isotropic_lorentz_linear',
                       microstrain_definition='WH 模型微应变参数；未无条件转换为 RMS 微应变')
    if diagnostics['intercept'] <= 0 or diagnostics['slope'] < 0:
        raise CalculationError('NONPHYSICAL_WH', 'WH 斜率为负或截距非正，未得到此模型下的物理有效解；未截断为零', details=diagnostics)
    return {'D': value(k * lam / diagnostics['intercept'], 'nm', 'wh_coherent_domain_size'),
            'epsilon_WH': value(diagnostics['slope'], '1', 'wh_model_microstrain'),
            'intercept': value(diagnostics['intercept'], 'rad')}, \
           ['WH 结果依赖同相、各向同性和 Lorentz 线性展宽假设；不无条件等同 RMS 微应变'], diagnostics


def calibration(record, config):
    component = required_text(config, 'component', '目标组分名称')
    source = required_text(config, 'calibration_source', '标样或校准来源')
    conditions = required_text(config, 'measurement_conditions', '校准测量条件')
    required_text(config, 'background', '背景处理方式')
    if config.get('conditions_match') is not True:
        raise CalculationError('CONDITIONS_MISMATCH', '须核对未知样与标样测量条件一致')
    metadata = record.get('metadata', {})
    if metadata.get('measurement_conditions') not in (None, '', conditions):
        raise CalculationError('CONDITIONS_MISMATCH', '记录中的测量条件与校准条件不同')
    basis = config.get('signal_basis')
    if str(record.get('technique', '')).lower() == 'ftir' and basis != 'absorbance':
        raise CalculationError('SIGNAL_BASIS', 'FTIR 定量须用吸光度响应；不能对已积分透过率直接取对数')
    if basis not in ('absorbance', 'raman_intensity', 'other_validated') or metadata.get('signal_basis') not in (None, '', basis):
        raise CalculationError('SIGNAL_BASIS', '未知样与标样响应口径不相容')
    response_field = config.get('response_field')
    if response_field not in ('area', 'height'):
        raise CalculationError('RESPONSE_FIELD', '校准响应仅支持指定的峰面积或峰高')
    response = field(record, response_field)
    definition = config.get('response_definition')
    allowed = ('range', 'total') if response_field == 'area' else ('height',)
    if definition not in allowed or response.get('definition') != definition:
        raise CalculationError('DEFINITION_MISMATCH', '未知样与标样响应定义不一致')
    if response_field == 'area' and definition == 'range':
        interval = config.get('integration_range')
        if not isinstance(interval, list) or len(interval) != 2 or finite(interval[0]) >= finite(interval[1]):
            raise CalculationError('INTEGRATION_RANGE', '区间面积校准须提供一致的积分范围')
        recorded_interval = metadata.get('integration_range')
        if recorded_interval is not None:
            try:
                if not isinstance(recorded_interval, list) or len(recorded_interval) != 2 or finite(recorded_interval[0]) >= finite(recorded_interval[1]):
                    raise CalculationError('INTEGRATION_RANGE', '未知样积分范围必须是两个递增的有限数值')
            except CalculationError as exc:
                raise CalculationError('INTEGRATION_RANGE', '未知样积分范围必须是两个递增的有限数值') from exc
            if recorded_interval != interval:
                raise CalculationError('INTEGRATION_RANGE', '未知样积分范围与标样不同')
    unit = config.get('concentration_unit', 'unknown'); target_unit = parse_unit(unit)
    kind = config.get('concentration_kind')
    fractions = {'mass_fraction', 'mole_fraction', 'volume_fraction'}
    if kind in fractions and target_unit.dims:
        raise CalculationError('UNIT_MISMATCH', '分数口径需要无量纲、百分比或 ppm 单位')
    if kind == 'concentration' and target_unit.dims not in (parse_unit('mg/mL').dims, parse_unit('mol/L').dims):
        raise CalculationError('UNIT_MISMATCH', '浓度需要质量/体积或物质的量/体积单位')
    if kind not in fractions | {'concentration'}:
        raise CalculationError('MEANING_MISMATCH', '请选择浓度或已支持的分数口径')
    signal_unit = config.get('signal_unit', 'unknown')
    signal = convert(response['value'], response.get('unit', 'unknown'), signal_unit)
    standards, coefficients = config.get('standards') or [], config.get('coefficients')
    if coefficients is not None:
        if not isinstance(coefficients, dict) or standards:
            raise CalculationError('CALIBRATION_INPUT', '标样表与已有校准系数须二选一')
        coefficient_source = required_text(coefficients, 'source', '已有校准系数来源')
        slope, intercept = finite(coefficients.get('slope')), finite(coefficients.get('intercept'))
        low, high = finite(coefficients.get('min_concentration')), finite(coefficients.get('max_concentration'))
        diagnostics = {'slope': slope, 'intercept': intercept, 'coefficient_source': coefficient_source}
    else:
        if not isinstance(standards, list) or not 3 <= len(standards) <= 1000 or any(not isinstance(r, dict) for r in standards):
            raise CalculationError('INSUFFICIENT_STANDARDS', '至少需要三个不同浓度的有效标样')
        x, y = [finite(s.get('concentration')) for s in standards], [finite(s.get('signal')) for s in standards]
        if len(set(x)) < 3:
            raise CalculationError('INSUFFICIENT_STANDARDS', '至少需要三个不同浓度的有效标样')
        if any(c < 0 or (kind in fractions and c * target_unit.scale > 1) for c in x):
            raise CalculationError('PHYSICAL_RANGE', '标样含量超出物理范围')
        diagnostics = linear_regression(x, y)
        slope, intercept = diagnostics['slope'], diagnostics['intercept']
        low, high = min(x), max(x)
    if slope <= 0:
        raise CalculationError('INVALID_CALIBRATION_SLOPE', '响应—含量校准斜率须为正且非零', details=diagnostics)
    if low < 0 or low >= high or (kind in fractions and high * target_unit.scale > 1):
        raise CalculationError('CALIBRATION_RANGE', '校准有效范围无效')
    concentration = (signal - intercept) / slope
    diagnostics.update(component=component, concentration_kind=kind, response_field=response_field,
                       signal_unit=signal_unit, concentration_unit=unit, signal=signal,
                       calibration_range=[low, high], calibration_source=source, measurement_conditions=conditions)
    tolerance = max(abs(low), abs(high), 1.) * 1e-12
    if concentration < -tolerance or (kind in fractions and concentration * target_unit.scale > 1 + 1e-12):
        raise CalculationError('PHYSICAL_RANGE', '计算含量超出所选口径的物理范围', details=diagnostics)
    if concentration < low - tolerance or concentration > high + tolerance:
        raise CalculationError('CALIBRATION_RANGE', '未知样超出校准范围，默认不外推', details=diagnostics)
    return {'concentration': value(concentration, unit, kind)}, \
           ['含量只适用于所记录组分、背景、响应及校准条件；未传播二次量不确定度'], diagnostics
