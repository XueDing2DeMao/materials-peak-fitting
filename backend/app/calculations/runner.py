"""统一计算入口、批次隔离及输入版本追溯。"""
from __future__ import annotations

import ast
import copy
import hashlib
import json
from collections import OrderedDict

import numpy as np

from .errors import CalculationError
from .expressions import compile_formula, evaluate_formula
from .materials import lattice, scherrer, relative_strain, williamson_hall, calibration
from .templates import METHOD_VERSION, METHODS
from .units import finite

METHOD_IDS = {method['id'] for method in METHODS}


def _configuration_types(method, config):
    catalog = next(item for item in METHODS if item['id'] == method)
    for entry in catalog['fields']:
        key, kind = entry['key'], entry['type']
        if key not in config: continue
        current = config[key]
        if kind in ('text', 'select') and not isinstance(current, str):
            raise CalculationError('INVALID_CONFIG', f'{entry["label"]}须为文本', key)
        if kind == 'boolean' and not isinstance(current, bool):
            raise CalculationError('INVALID_CONFIG', f'{entry["label"]}须为明确的是／否', key)
        if kind == 'number': finite(current, entry['label'])


def _payload(payload, allow_empty=False):
    if hasattr(payload, 'model_dump'):
        payload = payload.model_dump(mode='python')
    if not isinstance(payload, dict):
        raise CalculationError('INVALID_REQUEST', '计算请求须为对象')
    count, string_bytes = 0, 0

    def safe(node, depth=0):
        nonlocal count, string_bytes
        count += 1
        if count > 1000000 or depth > 24:
            raise CalculationError('REQUEST_LIMIT', '请求过大或嵌套过深')
        if isinstance(node, dict):
            for k, v in node.items():
                if not isinstance(k, str) or len(k) > 256:
                    raise CalculationError('INVALID_REQUEST', '对象字段名无效')
                safe(k, depth + 1); safe(v, depth + 1)
        elif isinstance(node, list):
            if len(node) > 10000:
                raise CalculationError('REQUEST_LIMIT', '单个列表不能超过 10000 项')
            for value in node: safe(value, depth + 1)
        elif isinstance(node, str):
            string_bytes += len(node.encode('utf-8'))
            if len(node) > 100000 or string_bytes > 10 * 1024 * 1024:
                raise CalculationError('REQUEST_LIMIT', '请求文本总量超限')
        elif isinstance(node, (int, float)) and not isinstance(node, bool):
            finite(node)
        elif node is not None and not isinstance(node, bool):
            raise CalculationError('INVALID_REQUEST', '请求包含非 JSON 数据')
    safe(payload)
    method, config, records = payload.get('method'), payload.get('config', {}), payload.get('records', [])
    if not isinstance(method, str) or method not in METHOD_IDS:
        raise CalculationError('UNKNOWN_METHOD', '未知计算方法')
    if not isinstance(config, dict) or not isinstance(records, list) or len(records) > 10000 or (not allow_empty and not records):
        raise CalculationError('REQUEST_LIMIT', '需要配置对象和 1—10000 条峰记录')
    ids = set()
    for record in records:
        if not isinstance(record, dict) or not isinstance(record.get('fields'), dict) or not isinstance(record.get('metadata', {}), dict):
            raise CalculationError('INVALID_RECORD', '峰记录须包含 fields 对象')
        if not isinstance(record.get('source', {}), dict):
            raise CalculationError('INVALID_RECORD', '峰来源须为对象')
        for key, quantity in record['fields'].items():
            if not isinstance(quantity, dict) or not isinstance(quantity.get('unit', 'unknown'), str) or not isinstance(quantity.get('definition', 'unknown'), str):
                raise CalculationError('INVALID_QUANTITY', f'峰字段 {key} 须为数值、单位与数量定义组成的对象')
        identifier = record.get('id')
        if not isinstance(identifier, str) or not identifier or identifier in ids:
            raise CalculationError('INVALID_RECORD', '峰记录 ID 不能为空或重复')
        ids.add(identifier)
    return records, method, config


def _base(records):
    warnings = []
    for record in records:
        existing = record.get('warnings', [])
        if isinstance(existing, list): warnings.extend(str(w) for w in existing)
        if record.get('status') in ('review', 'invalid'):
            warnings.append(f'输入记录 {record["id"]} 原状态为 {record["status"]}；计算只校验所需字段，不代表原拟合通过复核')
        if record.get('metadata', {}).get('stale') or record.get('source', {}).get('stale'):
            warnings.append(f'输入记录 {record["id"]} 标记为失效结果，请复核来源')
    return {'record_ids': [record['id'] for record in records], 'sample_id': records[0].get('sample_id', ''),
            'values': {}, 'status': 'valid', 'warnings': list(dict.fromkeys(warnings))}


def evaluate_request(payload):
    records, method, config = _payload(payload)
    requested_ids = config.get('record_ids')
    if requested_ids is not None:
        if not isinstance(requested_ids, list) or not requested_ids or any(not isinstance(identifier, str) for identifier in requested_ids) or len(set(requested_ids)) != len(requested_ids) or not set(requested_ids) <= {r['id'] for r in records}:
            raise CalculationError('RECORD_SELECTION', '所选记录 ID 无效、重复或为空')
        records = [record for record in records if record['id'] in requested_ids]
    compiled = compile_formula(config) if method == 'formula' else None
    canonical = {'records': records, 'method': method, 'method_version': METHOD_VERSION, 'config': config}
    digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')).hexdigest()
    groups = []
    if method == 'williamson_hall' or (method == 'formula' and config.get('scope', 'row') != 'row'):
        group_by = config.get('group_by', 'sample') if method == 'williamson_hall' else config['scope']
        if group_by not in ('sample', 'spectrum'):
            raise CalculationError('GROUPING', 'WH 分组方式只能为 sample 或 spectrum')
        grouped = OrderedDict()
        for record in records:
            key = record.get('sample_id' if group_by == 'sample' else 'spectrum_id')
            if not isinstance(key, str) or not key:
                raise CalculationError('GROUPING', 'WH 联合计算须明确样品／谱分组，不能把无身份峰合并')
            grouped.setdefault(key, []).append(record)
        groups = list(grouped.values())
    else:
        groups = [[record] for record in records]
    if compiled:
        ast_cost = sum(sum(1 for _ in ast.walk(tree)) for _, tree, _ in compiled[1].values())
        if ast_cost * len(groups) + len(compiled[0]) * len(records) > 2000000:
            raise CalculationError('COMPUTATION_LIMIT', '本批公式计算量超过 200 万节点预算，请减少输出复杂度或分批计算')
    results = []
    for group in groups:
        result = _base(group)
        try:
            _configuration_types(method, config)
            with np.errstate(over='raise', divide='raise', invalid='raise'):
                if method == 'formula':
                    values, issues = evaluate_formula(group, compiled)
                    result['values'] = values
                    result['details'] = {'output_issues': issues, 'execution_scope': config.get('scope', 'row'),
                                         'method_label': '用户自定义公式', 'applicability': config.get('applicability', '')}
                    if issues:
                        result.update(status='invalid', error=issues[0])
                else:
                    if method == 'williamson_hall':
                        values, warnings, details = williamson_hall(group, config)
                    elif method == 'scherrer':
                        values, warnings, details, apparent = scherrer(group[0], config)
                        if apparent: result['status'] = 'apparent'
                    else:
                        function = {'lattice': lattice, 'strain': relative_strain, 'calibration': calibration}[method]
                        values, warnings, details = function(group[0], config)
                    result['values'] = values; result['details'] = details
                    result['warnings'].extend(warnings)
        except CalculationError as exc:
            result.update(status='invalid', error=exc.as_dict())
            if exc.details: result['details'] = exc.details
        except (FloatingPointError, OverflowError, np.linalg.LinAlgError) as exc:
            result.update(status='invalid', error={'code': 'NUMERICAL_FAILURE', 'message': '计算超出有限数值范围或无法稳定求解'})
        result['warnings'] = list(dict.fromkeys(result['warnings']))
        results.append(result)
    response = {'method': method, 'method_version': METHOD_VERSION, 'input_hash': digest,
                'configuration': copy.deepcopy(config), 'results': results}
    json.dumps(response, ensure_ascii=False, allow_nan=False)
    return response


def validate_request(payload):
    try:
        records, method, config = _payload(payload, allow_empty=True)
        if method == 'formula': compile_formula(config)
        if not records:
            if method != 'formula':
                raise CalculationError('MISSING_RECORDS', '科学方法验证需要所选峰记录')
            return {'valid': True, 'issues': [], 'method': method, 'method_version': METHOD_VERSION}
        response = evaluate_request(payload)
        issues = [{**result['error'], 'record_ids': result['record_ids']} for result in response['results'] if result['status'] == 'invalid']
        return {'valid': not issues, 'issues': issues, 'method': method, 'method_version': METHOD_VERSION}
    except CalculationError as exc:
        return {'valid': False, 'issues': [exc.as_dict()]}
