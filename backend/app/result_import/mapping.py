"""显式列映射和可校验的模板指纹。"""
import re
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from ..peak_records import StrictRecord, content_hash, validate_json_value
from .readers import headers, select_sheet


ALIASES = {
    'sample_id': ['sample', 'sampleid', '样品', '样品id', '样品编号'],
    'spectrum_id': ['spectrum', 'spectrumid', '谱', '谱id', '谱编号'],
    'peak_id': ['peak', 'peakid', 'component', '峰', '峰id', '峰编号'],
    'label': ['label', 'name', '峰名', '名称'], 'model': ['model', 'function', '模型', '峰形'],
    'position': ['position', 'center', 'centre', 'xc', 'peakposition', '2theta', 'twotheta', '峰位', '峰位置', '峰顶'],
    'width': ['width', 'fwhm', 'hwhm', 'sigma', 'σ', 'w', '峰宽', '半高宽', '半高全宽'],
    'height': ['height', 'intensity', 'peakheight', '峰高', '峰强'],
    'area': ['area', 'integratedintensity', 'integral', 'a', '面积', '峰面积', '积分强度'],
    'rmse': ['rmse', '均方根误差'], 'r_squared': ['r2', 'rsquared', 'r²', '决定系数'],
    'rss': ['rss', 'sse', '残差平方和'], 'chi_square': ['chi2', 'chisquare', 'χ²'],
    'parameter': ['parameter', 'param', '参数', '参数名'], 'value': ['value', '数值', '值'],
    'unit': ['unit', 'units', '单位'], 'standard_error': ['se', 'stderr', 'standarderror', '标准误'],
    'scope': ['scope', '范围', '层级'],
}


def alias_key(value):
    return re.sub(r'[\s_\-]+', '', str(value or '').strip().lower())


def parameter_name(value, custom=None):
    if custom and str(value) in custom: return custom[str(value)]
    key = alias_key(value)
    for name in ('position', 'width', 'height', 'area', 'rmse', 'r_squared', 'rss', 'chi_square'):
        if key in ALIASES[name]: return name
    return None


class ResultMapping(StrictRecord):
    sheet: str
    layout: Literal['wide', 'long'] = 'wide'
    header_row: int = Field(default=1, ge=1)
    data_start_row: int | None = Field(default=None, ge=1)
    data_end_row: int | None = Field(default=None, ge=1)
    columns: dict[str, str | int] = Field(default_factory=dict)
    units: dict[str, str] = Field(default_factory=dict)
    width_definition: Literal['fwhm', 'hwhm', 'sigma', 'unknown'] = 'unknown'
    position_definition: Literal['two_theta', 'apex', 'model_position', 'centroid', 'unknown'] = 'unknown'
    area_definition: Literal['total', 'range', 'unknown'] = 'unknown'
    default_model: str = 'unknown'
    technique: Literal['general', 'xrd', 'raman', 'ftir', 'xps'] = 'general'
    parameter_aliases: dict[str, str] = Field(default_factory=dict)
    fingerprint: str | None = None
    template_version: Literal[1] = 1
    metadata: dict[str, Any] = Field(default_factory=dict)

    @field_validator('metadata')
    @classmethod
    def safe_metadata(cls, value): return validate_json_value(value)

    @field_validator('columns', mode='before')
    @classmethod
    def valid_columns(cls, value):
        if not isinstance(value, dict): raise ValueError('列映射必须为对象')
        allowed = set(ALIASES) | {'position_se', 'width_se', 'height_se', 'area_se'}
        if set(value)-allowed: raise ValueError('映射包含未知字段')
        if any(isinstance(v, bool) or isinstance(v, int) and v < 0 for v in value.values()): raise ValueError('列号必须为非负整数')
        return value

    @field_validator('parameter_aliases')
    @classmethod
    def valid_parameter_aliases(cls, value):
        if any(v not in {'position', 'width', 'height', 'area', 'rmse', 'r_squared', 'rss', 'chi_square'} for v in value.values()):
            raise ValueError('参数别名必须映射到支持的峰参数或谱级指标')
        return value

    @model_validator(mode='after')
    def valid_range(self):
        if self.data_start_row is not None and self.data_start_row <= self.header_row: raise ValueError('数据范围必须在表头之后')
        if self.data_end_row is not None and self.data_end_row < (self.data_start_row or self.header_row+1): raise ValueError('数据范围结束行小于开始行')
        if self.layout == 'long' and not {'parameter', 'value'} <= set(self.columns): raise ValueError('长表需要参数名和值列')
        return self


def resolve_columns(columns, mapped):
    result = {}
    for field, ref in mapped.items():
        if isinstance(ref, int):
            if not 0 <= ref < len(columns): raise ValueError(f'映射列号超出范围：{ref}')
            result[field] = ref
        else:
            matches = [i for i, c in enumerate(columns) if c == ref]
            if len(matches) != 1: raise ValueError(f'映射列不存在或重复歧义：{ref}')
            result[field] = matches[0]
    return result


def mapping_fingerprint(book, mapping: ResultMapping):
    sheet = select_sheet(book, mapping.sheet)
    cols = headers(sheet, mapping.header_row)
    # 明确映射、定义及单位变化都必须复核，不依赖文件名或数值内容。
    config = mapping.model_dump(exclude={'fingerprint', 'metadata', 'sheet', 'data_start_row', 'data_end_row'})
    column_signature = cols if any(isinstance(v, int) for v in mapping.columns.values()) else sorted(cols)
    unit_signature = []
    if mapping.layout == 'long' and 'unit' in mapping.columns:
        indices = resolve_columns(cols, mapping.columns)
        observed = set()
        for row in sheet.rows[(mapping.data_start_row or mapping.header_row+1)-1:mapping.data_end_row]:
            p, u = indices['parameter'], indices['unit']
            if max(p, u) < len(row) and row[p] is not None:
                observed.add((str(row[p]).strip(), str(row[u] or '').strip()))
        unit_signature = [list(item) for item in sorted(observed)]
    return content_hash({'columns': column_signature, 'rules': config, 'source_units': unit_signature})


def suggest_mapping(book, sheet=None, header_row=1):
    s = select_sheet(book, sheet or book.sheets[0].name)
    cols = headers(s, header_row); mapping = {}
    for field, aliases in ALIASES.items():
        matches = [c for c in cols if alias_key(c) in aliases]
        if len(matches) == 1 and cols.count(matches[0]) == 1: mapping[field] = matches[0]
    for field in ('position', 'width', 'height', 'area'):
        aliases = {f'{name}{ending}' for name in ALIASES[field] for ending in ('se', 'stderr', 'standarderror', '标准误')}
        matches = [c for c in cols if alias_key(c) in aliases]
        if len(matches) == 1: mapping[f'{field}_se'] = matches[0]
    width_key = alias_key(mapping.get('width', ''))
    definition = width_key if width_key in ('fwhm', 'hwhm', 'sigma') else 'sigma' if width_key == 'σ' else 'unknown'
    m = ResultMapping(sheet=s.name, header_row=header_row, layout='long' if {'parameter', 'value'} <= set(mapping) else 'wide', columns=mapping, width_definition=definition)
    return m.model_dump(mode='json')
