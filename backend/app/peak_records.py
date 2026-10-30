"""独立标准峰记录；不改变既有求解请求、响应或档案。"""
from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, field_validator, model_validator


def validate_json_value(value: Any, *, max_nodes: int = 500000, max_depth: int = 32):
    """校验可持久化 JSON，拒绝非有限数值、对象实例与危险属性键。"""
    count = 0
    def walk(v, depth):
        nonlocal count
        count += 1
        if count > max_nodes or depth > max_depth:
            raise ValueError('JSON 内容超过容量或嵌套限制')
        if v is None or isinstance(v, bool): return
        if isinstance(v, (int, float)):
            try: finite = math.isfinite(v)
            except (OverflowError, TypeError): finite = False
            if not finite: raise ValueError('JSON 包含非有限数值')
        elif isinstance(v, str):
            if len(v) > 20000: raise ValueError('JSON 文本超过长度限制')
        elif isinstance(v, list):
            for child in v: walk(child, depth + 1)
        elif isinstance(v, dict):
            for key, child in v.items():
                if not isinstance(key, str) or key in {'__proto__', 'constructor', 'prototype'}:
                    raise ValueError('JSON 包含非法键')
                walk(key, depth + 1); walk(child, depth + 1)
        else: raise ValueError('仅接受 JSON 基本类型')
    walk(value, 0)
    return value


class StrictRecord(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Quantity(StrictRecord):
    value: FiniteFloat | None = None
    unit: str = 'unknown'
    definition: str = 'unknown'
    raw_value: Any = None
    raw_definition: str | None = None
    source_column: str | None = None
    source_row: int | None = Field(default=None, ge=1)
    source_cell: str | None = None
    reason: str | None = None
    standard_error: FiniteFloat | None = Field(default=None, ge=0)
    standard_error_column: str | None = None
    standard_error_row: int | None = Field(default=None, ge=1)
    standard_error_cell: str | None = None
    raw_standard_error: Any = None

    @field_validator('raw_value', 'raw_standard_error')
    @classmethod
    def scalar(cls, value):
        if isinstance(value, (dict, list)): raise ValueError('原始单元格必须为标量')
        return validate_json_value(value)


class PeakFields(StrictRecord):
    position: Quantity = Field(default_factory=lambda: Quantity(reason='未提供峰位'))
    width: Quantity = Field(default_factory=lambda: Quantity(reason='未提供峰宽'))
    height: Quantity = Field(default_factory=lambda: Quantity(definition='height', reason='未提供峰高'))
    area: Quantity = Field(default_factory=lambda: Quantity(reason='未提供积分面积'))


class RecordSource(StrictRecord):
    filename: str
    file_sha256: str | None = Field(default=None, pattern=r'^[a-fA-F0-9]{64}$')
    sheet: str = ''
    row: int | None = Field(default=None, ge=1)
    columns: dict[str, str] = Field(default_factory=dict)
    parser_version: str = '1'
    record_number: int | None = Field(default=None, ge=1)
    physical_line_start: int | None = Field(default=None, ge=1)
    physical_line_end: int | None = Field(default=None, ge=1)
    x_column: str | None = None
    y_column: str | None = None


class PeakRecord(StrictRecord):
    id: str = Field(min_length=1, max_length=512)
    sample_id: str = Field(min_length=1, max_length=512)
    spectrum_id: str = Field(min_length=1, max_length=512)
    peak_id: str = Field(min_length=1, max_length=512)
    label: str = ''
    technique: str = 'general'
    model: str = 'unknown'
    fields: PeakFields = Field(default_factory=PeakFields)
    source: RecordSource
    warnings: list[str] = Field(default_factory=list)
    status: Literal['valid', 'review', 'invalid'] = 'review'
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator('metadata')
    @classmethod
    def metadata_safe(cls, value): return validate_json_value(value)


class SpectrumResult(StrictRecord):
    id: str
    sample_id: str
    metrics: dict[str, Quantity] = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class ImportIssue(StrictRecord):
    code: str
    message: str
    severity: Literal['warning', 'error'] = 'warning'
    row: int | None = None
    column: str | None = None
    record_id: str | None = None
    source_file: str | None = None
    source_sha256: str | None = None
    source_sheet: str | None = None


class NormalizedAnalysis(StrictRecord):
    schema_version: Literal[1] = 1
    records: list[PeakRecord] = Field(default_factory=list, max_length=10000)
    spectra: list[SpectrumResult] = Field(default_factory=list, max_length=10000)
    issues: list[ImportIssue] = Field(default_factory=list)
    mapping: dict[str, Any] | None = None
    fingerprint: str | None = None

    @field_validator('mapping')
    @classmethod
    def safe_mapping(cls, value): return validate_json_value(value)

    @model_validator(mode='after')
    def consistent_ids(self):
        ids = [r.id for r in self.records]
        spectra = {s.id: s for s in self.spectra}
        if len(ids) != len(set(ids)) or len(spectra) != len(self.spectra): raise ValueError('峰记录或谱 ID 重复')
        if any(r.spectrum_id not in spectra or r.sample_id != spectra[r.spectrum_id].sample_id for r in self.records):
            raise ValueError('峰记录引用了不存在或样品不匹配的谱')
        return self


def content_hash(value: Any) -> str:
    validate_json_value(value)
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()).hexdigest()


def canonical_model(value: Any) -> str:
    key = str(value or '').strip().lower().replace(' ', '').replace('-', '_')
    return {'gauss': 'gaussian', 'gaussian': 'gaussian', '高斯': 'gaussian', 'lorentzian': 'lorentz',
            'lorentz': 'lorentz', '洛伦兹': 'lorentz', 'psdvoigt1': 'psd_voigt1', 'psdvoigt2': 'psd_voigt2',
            'splitpseudovoigt': 'split_psd_voigt', '': 'unknown'}.get(key, key)


def adapt_internal_result(engine: str, result: dict, source: dict | None = None, mode: str = 'general', metadata: dict | None = None) -> dict:
    """只转换已保存结果，不求解、不补造原谱或未报告不确定度。"""
    if engine not in {'single', 'multi', 'xps'}: raise ValueError('未知内部求解路径')
    validate_json_value(result); validate_json_value(metadata or {}); validate_json_value(source or {})
    if not isinstance(result, dict) or metadata is not None and not isinstance(metadata, dict) or source is not None and not isinstance(source, dict):
        raise ValueError('内部结果、来源及元数据必须为对象')
    for key in ('configuration', 'diagnostics', 'statistics', 'parameters', 'peak_geometry'):
        if key in result and not isinstance(result[key], dict): raise ValueError(f'内部结果 {key} 必须为对象')
    def checked_warnings(value):
        if not isinstance(value, list) or any(not isinstance(v, str) for v in value): raise ValueError('警告必须为文本列表')
        return value
    metadata = dict(metadata or {})
    original_source = source or result.get('configuration', {}).get('source') or {}
    if not isinstance(original_source, dict): raise ValueError('内部来源必须为对象')
    src = RecordSource(filename=original_source.get('filename', '内部拟合结果'),
                       file_sha256=original_source.get('file_sha256'), sheet=original_source.get('sheet', ''),
                       x_column=original_source.get('x_column'), y_column=original_source.get('y_column'))
    digest = content_hash({'engine': engine, 'result': result, 'source': original_source, 'metadata': metadata})
    sample = str(metadata.get('sample_id') or f'internal-{digest[:12]}')
    spectrum = f'fit-{digest[:24]}'
    technique = 'xps' if engine == 'xps' else mode
    unit = 'deg' if technique == 'xrd' else 'eV' if technique == 'xps' else str(metadata.get('x_unit') or 'unknown')
    y_unit = str(metadata.get('y_unit') or 'unknown')
    warnings = list(checked_warnings(result.get('diagnostics', {}).get('warnings', [])))
    if result.get('converged') is not True: warnings.append('原拟合未收敛或未报告收敛状态')
    if metadata.get('stale'): warnings.append('原拟合结果已失效')
    cs = [dict(id='p1', label='峰 1', **{k: result[k] for k in ('model', 'parameters', 'peak_geometry') if k in result})] if engine == 'single' else result.get('components', [])
    if not isinstance(cs, list) or not cs or len(cs) > 40 or any(not isinstance(c, dict) for c in cs):
        raise ValueError('内部结果缺少有效峰分量或超过 40 峰')
    records = []
    for index, c in enumerate(cs):
        params, g = c.get('parameters', {}), c.get('peak_geometry') or {}
        if not isinstance(params, dict) or not isinstance(g, dict) or any(not isinstance(p, dict) for p in params.values()):
            raise ValueError('峰参数与峰性质必须为对象')
        model = canonical_model(c.get('model'))
        fields = {}
        for name, geom, param, definition, units in (
            ('position', 'peak_position', 'xc', 'two_theta' if technique == 'xrd' else 'apex', unit),
            ('width', 'fwhm', 'w' if model in {'gaussian', 'lorentz', 'psd_voigt1'} else '', 'fwhm', unit),
            ('height', 'peak_height', '', 'height', y_unit),
            ('area', 'area_total', 'A', 'total', f'{y_unit}*{unit}' if 'unknown' not in (y_unit, unit) else 'unknown')):
            p = params.get(param, {})
            value = g.get(geom)
            source_column = f'peak_geometry.{geom}'
            if geom not in g:
                if param:
                    value = p.get('value'); source_column = f'parameters.{param}.value'
                if value is None:
                    legacy_key = {'height': 'height', 'area': 'area_total', 'width': 'fwhm'}.get(name, '')
                    value = c.get(legacy_key); source_column = legacy_key or source_column
            reasons = g.get('reasons') or {}
            if not isinstance(reasons, dict): raise ValueError('峰性质缺失原因必须为对象')
            fields[name] = Quantity(value=value, unit=units, definition=definition, raw_value=value,
                source_column=source_column, reason=None if value is not None else reasons.get(geom) or '原结果未报告',
                standard_error=p.get('standard_error') if value is not None else None)
        peak_id = str(c.get('id') or f'p{index+1}')
        local_warnings = warnings + checked_warnings(g.get('warnings', []))
        if any(q.value is None or q.unit == 'unknown' for q in fields.values()): local_warnings.append('部分字段或单位未报告')
        records.append(PeakRecord(id=f'{spectrum}:{peak_id}', sample_id=sample, spectrum_id=spectrum, peak_id=peak_id,
            label=str(c.get('label') or peak_id), technique=technique, model=model, fields=PeakFields(**fields), source=src,
            warnings=list(dict.fromkeys(local_warnings)), status='review' if local_warnings else 'valid',
            metadata={**metadata, 'result_sha256': digest, 'origin': 'internal_fit', 'engine': engine}))
    metrics = {str(k): Quantity(value=v, raw_value=v, definition=str(k), source_column=f'statistics.{k}')
               for k, v in result.get('statistics', {}).items() if v is None or isinstance(v, (int, float)) and not isinstance(v, bool)}
    return NormalizedAnalysis(records=records, spectra=[SpectrumResult(id=spectrum, sample_id=sample, metrics=metrics, warnings=warnings)]).model_dump(mode='json')
