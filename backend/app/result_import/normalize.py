"""显式数量定义下的峰表标准化；坏字段不吞行，不混淆谱级误差。"""
from __future__ import annotations

import math

from openpyxl.utils import get_column_letter

from ..peak_records import (ImportIssue, NormalizedAnalysis, PeakFields, PeakRecord, Quantity,
                            RecordSource, SpectrumResult, canonical_model, content_hash)
from .mapping import ResultMapping, alias_key, mapping_fingerprint, parameter_name, resolve_columns
from .readers import headers, select_sheet

FIELDS = ('position', 'width', 'height', 'area')
METRICS = ('rmse', 'r_squared', 'rss', 'chi_square')


def normalize_unit(value):
    text = str(value or '').strip()
    return {'': 'unknown', '°': 'deg', 'degree': 'deg', 'degrees': 'deg', '度': 'deg',
            'radian': 'rad', 'radians': 'rad', '弧度': 'rad', 'cm⁻¹': 'cm^-1', 'cm-1': 'cm^-1',
            'ångström': 'angstrom', 'Å': 'angstrom', 'Å': 'angstrom'}.get(text, text)


def number(value):
    if value is None or isinstance(value, str) and value.strip().lower() in ('', '-', '—', 'na', 'n/a', 'null', 'none'):
        return None, '未提供数值'
    if isinstance(value, bool): return None, '布尔值不能作为参数数值'
    try: result = float(value)
    except (ValueError, TypeError, OverflowError):
        return None, '无法识别数值；小数逗号或分隔符歧义需先确认' if ',' in str(value) else '无法识别数值'
    if not math.isfinite(result): return None, '数值必须有限'
    return result, None


def normalize_result(book, mapping):
    m = mapping if isinstance(mapping, ResultMapping) else ResultMapping.model_validate(mapping)
    sheet = select_sheet(book, m.sheet); cols = headers(sheet, m.header_row)
    indices = resolve_columns(cols, m.columns)
    fingerprint = mapping_fingerprint(book, m)
    if m.fingerprint and m.fingerprint != fingerprint: raise ValueError('映射模板指纹不匹配，请重新核对表头、单位和数量定义')
    saved_mapping = m.model_dump(mode='json'); saved_mapping['fingerprint'] = fingerprint
    start, end = m.data_start_row or m.header_row + 1, m.data_end_row or len(sheet.rows)
    if end > len(sheet.rows) or start > len(sheet.rows)+1: raise ValueError('数据范围超出结果表')
    issues, groups, spectra, metric_conflicts, peak_rows = [], {}, {}, set(), {}
    namespace = content_hash([book.file_sha256, m.sheet])[:16]

    def issue(code, message, row, field=None, severity='warning', record_id=None):
        col = cols[indices[field]] if field in indices else field
        issues.append(ImportIssue(code=code, message=message, severity=severity, row=row, column=col, record_id=record_id,
                                  source_file=book.filename, source_sha256=book.file_sha256, source_sheet=m.sheet))

    def cell(row, name):
        idx = indices.get(name)
        return row[idx] if idx is not None and idx < len(row) else None

    def column(name):
        return cols[indices[name]] if name in indices else None

    def coordinate(r, name):
        return f'{get_column_letter(indices[name]+1)}{r}' if book.kind in ('xlsx', 'xls', 'xlsm') and name in indices else None

    def quantity(field, raw, row, source_field, model, unit=None, se=None, se_field=None, definition=None):
        value, reason = number(raw)
        source_idx = indices.get(source_field)
        cached_issue = sheet.cell_issues.get((row, source_idx))
        if cached_issue: value, reason = None, cached_issue
        q = Quantity(value=value, unit=normalize_unit(unit or m.units.get(field)), definition=definition or
                     (m.position_definition if field == 'position' else m.area_definition if field == 'area' else 'height' if field == 'height' else m.width_definition),
                     raw_value=raw, raw_definition=definition, source_column=column(source_field), source_row=row,
                     source_cell=coordinate(row, source_field), reason=reason)
        if value is None:
            missing = reason == '未提供数值'
            issue('missing_value' if missing else 'invalid_value', reason, row, source_field, 'warning' if missing else 'error')
        factor = 1.0
        if field == 'width':
            raw_definition = definition or m.width_definition
            q.raw_definition = raw_definition
            if value is not None and value <= 0:
                q.value = None; q.reason = '峰宽必须为正数'
                issue('invalid_width', q.reason, row, source_field, 'error')
            elif raw_definition == 'fwhm': q.definition = 'fwhm'
            elif raw_definition == 'sigma' and model == 'gaussian':
                factor = math.sqrt(8 * math.log(2)); q.definition = 'fwhm'
            elif raw_definition == 'hwhm' and model in ('gaussian', 'lorentz', 'psd_voigt1', 'psd_voigt2'):
                factor = 2; q.definition = 'fwhm'
            else:
                q.value = None; q.definition = 'unknown'
                q.reason = '宽度定义或模型不足以换算整体 FWHM；单侧非对称 HWHM 不可乘二'
                issue('width_definition', q.reason, row, source_field)
            if q.value is not None:
                converted = q.value * factor
                if math.isfinite(converted): q.value = converted
                else:
                    q.value = None; q.reason = '峰宽换算超出有限数值范围'
                    issue('invalid_value', q.reason, row, source_field, 'error')
        if se_field:
            se_value, se_reason = number(se)
            q.raw_standard_error = se
            q.standard_error_column = column(se_field); q.standard_error_row = row; q.standard_error_cell = coordinate(row, se_field)
            if se_value is not None and se_value < 0: se_value, se_reason = None, '标准误不能为负数'
            if se_reason and se_reason != '未提供数值': issue('invalid_standard_error', se_reason, row, se_field, 'error')
            q.standard_error = se_value * factor if se_value is not None and q.value is not None else None
            if q.standard_error is not None and not math.isfinite(q.standard_error):
                q.standard_error = None
                issue('invalid_standard_error', '标准误换算超出有限数值范围', row, se_field, 'error')
        if q.unit == 'unknown': issue('unknown_unit', '字段单位未明确', row, source_field)
        if field in ('position', 'area') and q.definition == 'unknown': issue('unknown_definition', '数量定义未明确，保留原值供复核', row, source_field)
        return q

    def identity(row, r):
        sample_raw, spectrum_raw = cell(row, 'sample_id'), cell(row, 'spectrum_id')
        sample = str(sample_raw).strip() if sample_raw is not None and str(sample_raw).strip() else f'sample-{namespace}'
        spectrum_label = str(spectrum_raw).strip() if spectrum_raw is not None and str(spectrum_raw).strip() else 'spectrum-1'
        spectrum = f'sp-{content_hash([book.file_sha256, m.sheet, sample, spectrum_label])[:24]}'
        if spectrum not in spectra: spectra[spectrum] = SpectrumResult(id=spectrum, sample_id=sample)
        peak_raw = cell(row, 'peak_id')
        peak = str(peak_raw).strip() if peak_raw is not None and str(peak_raw).strip() else f'p{r}' if m.layout == 'wide' else 'p1'
        return sample, spectrum, peak, spectrum_label

    def metric(field, raw, row, spectrum, value_field, unit=None):
        key = (spectrum, field)
        q = quantity(field, raw, row, value_field, 'unknown', unit=unit, definition=field)
        q.definition = field
        old = spectra[spectrum].metrics.get(field)
        if key in metric_conflicts: return
        if old is not None and old.value != q.value:
            old.value = None; old.reason = '同一谱的质量指标冲突，未采用任一值'
            spectra[spectrum].warnings.append(old.reason)
            metric_conflicts.add(key); issue('conflicting_metric', old.reason, row, value_field, 'error')
        elif old is None: spectra[spectrum].metrics[field] = q

    for r in range(start, end+1):
        row = sheet.rows[r-1]
        if not any(v is not None and str(v).strip() for v in row): continue
        sample, spectrum, peak, spectrum_label = identity(row, r)
        name = parameter_name(cell(row, 'parameter'), m.parameter_aliases) if m.layout == 'long' else None
        if m.layout == 'long':
            if name is None:
                issue('unknown_parameter', f'未识别参数：{cell(row, "parameter")}', r, 'parameter'); continue
            if name in METRICS:
                metric(name, cell(row, 'value'), r, spectrum, 'value', cell(row, 'unit')); continue
            if str(cell(row, 'scope') or '').strip().lower() in ('spectrum', '谱', '谱级'):
                issue('invalid_scope', '峰参数不能声明为谱级指标', r, 'scope', 'error'); continue
        key = (spectrum, peak, r if m.layout == 'wide' else None)
        if m.layout == 'wide':
            prior_row = peak_rows.get((spectrum, peak))
            if prior_row is not None:
                issue('duplicate_peak_id', '同一谱包含重复峰 ID，请核对样品/谱分组和峰编号', prior_row, 'peak_id', 'error')
                issue('duplicate_peak_id', '同一谱包含重复峰 ID，请核对样品/谱分组和峰编号', r, 'peak_id', 'error')
            else: peak_rows[spectrum, peak] = r
        if key not in groups:
            if len(groups) >= 10000: raise ValueError('每批最多 10000 个峰记录，请分批处理')
            warnings = []
            if not cell(row, 'sample_id'): warnings.append('未提供样品 ID，已生成技术 ID；不代表真实样品身份')
            if not cell(row, 'spectrum_id'): warnings.append('未提供谱 ID，按当前文件工作表生成技术分组；多谱表请显式映射')
            if not cell(row, 'peak_id'): warnings.append('未提供峰 ID，已生成技术峰编号')
            model = canonical_model(cell(row, 'model') or m.default_model)
            record_id = f'peak-{content_hash([book.file_sha256, fingerprint, spectrum, peak, r])[:24]}'
            groups[key] = {'id': record_id, 'sample': sample, 'spectrum': spectrum, 'peak': peak,
                'label': str(cell(row, 'label') or peak), 'model': model, 'fields': {}, 'row': r, 'rows': [],
                'warnings': warnings, 'metadata': {**m.metadata, 'origin': 'external_table', 'source_spectrum_label': spectrum_label,
                    'source_model': str(cell(row, 'model') or m.default_model),
                    'import_mapping': saved_mapping, 'import_fingerprint': fingerprint}}
        g = groups[key]; g['rows'].append(r)
        explicit_model = cell(row, 'model')
        if m.layout == 'long' and explicit_model and canonical_model(explicit_model) != g['model']:
            g['model'] = 'unknown'
            issue('conflicting_model', '同一峰出现不同模型，不能确定模型相关宽度换算', r, 'model', 'error', g['id'])
            previous_width = g['fields'].get('width')
            if previous_width and previous_width.raw_definition in ('sigma', 'hwhm'):
                previous_width.value = None; previous_width.standard_error = None
                previous_width.reason = '模型冲突，不能保留模型相关宽度换算'
        names = [name] if m.layout == 'long' else [f for f in FIELDS if f in indices]
        for field in names:
            src = 'value' if m.layout == 'long' else field
            se_src = 'standard_error' if m.layout == 'long' else f'{field}_se'
            definition = None
            if m.layout == 'long' and field == 'width':
                declared = alias_key(cell(row, 'parameter'))
                if declared in ('fwhm', 'hwhm', 'sigma', 'σ'): definition = 'sigma' if declared == 'σ' else declared
            q = quantity(field, cell(row, src), r, src, g['model'], unit=cell(row, 'unit') if m.layout == 'long' else None,
                         se=cell(row, se_src), se_field=se_src if se_src in indices else None, definition=definition)
            if field in g['fields']:
                g['fields'][field].value = None; g['fields'][field].standard_error = None
                g['fields'][field].reason = '同一峰重复提供该参数，未自动覆盖'
                issue('duplicate_field', g['fields'][field].reason, r, src, 'error', g['id'])
            else: g['fields'][field] = q
        if m.layout == 'wide':
            for field in METRICS:
                if field in indices: metric(field, cell(row, field), r, spectrum, field)

    records, issues_by_row = [], {}
    for item in issues: issues_by_row.setdefault(item.row, []).append(item)
    for g in groups.values():
        local = [item for row in g['rows'] for item in issues_by_row.get(row, [])]
        warnings = g['warnings'] + [i.message for i in local]
        fields = PeakFields(**g['fields'])
        if len(g['fields']) < 4: warnings.append('部分峰参数未提供；仅可计算输入充分的结果')
        location = sheet.locations[g['row']-1]
        source = RecordSource(filename=book.filename, file_sha256=book.file_sha256, sheet=m.sheet,
            columns={k: cols[v] for k, v in indices.items()}, **location)
        g['metadata']['source_rows'] = g['rows']
        records.append(PeakRecord(id=g['id'], sample_id=g['sample'], spectrum_id=g['spectrum'], peak_id=g['peak'],
            label=g['label'], technique=m.technique, model=g['model'], fields=fields, source=source,
            warnings=list(dict.fromkeys(warnings)), status='invalid' if any(i.severity == 'error' for i in local) else 'review' if warnings else 'valid', metadata=g['metadata']))
    if not records: raise ValueError('所选范围与映射没有产生峰记录；请核对布局、参数列和数据范围')
    return NormalizedAnalysis(records=records, spectra=list(spectra.values()), issues=issues,
                              mapping=saved_mapping, fingerprint=fingerprint).model_dump(mode='json')
