"""逐节点解释表达式；不执行 eval/exec 或用户 Python。"""
from __future__ import annotations

import ast
import math
import re

from .errors import CalculationError
from .units import Quantity, finite, parse_unit

FUNCTIONS = {'abs', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'log10', 'exp', 'radians', 'degrees', 'min', 'max'}
CONSTANTS = {'pi': Quantity(math.pi), 'e': Quantity(math.e)}
MAX_EXPRESSION_LENGTH, MAX_AST_NODES, MAX_DEPTH = 2048, 256, 24


def identifier(value):
    return isinstance(value, str) and bool(re.fullmatch(r'[A-Za-z][A-Za-z0-9_]{0,63}', value)) and value not in FUNCTIONS | CONSTANTS.keys()


def parse_expression(expression):
    if not isinstance(expression, str) or not expression.strip() or len(expression) > MAX_EXPRESSION_LENGTH:
        raise CalculationError('EXPRESSION_LIMIT', '表达式须为 1—2048 个字符')
    depth = 0
    for ch in expression:
        if ch in '([{':
            depth += 1
            if depth > MAX_DEPTH:
                raise CalculationError('EXPRESSION_LIMIT', '表达式嵌套超过 24 层')
        elif ch in ')]}':
            depth -= 1
    try:
        tree = ast.parse(expression, mode='eval')
    except (SyntaxError, ValueError, RecursionError, MemoryError) as exc:
        raise CalculationError('EXPRESSION_SYNTAX', '表达式语法无效') from exc
    if sum(1 for _ in ast.walk(tree)) > MAX_AST_NODES:
        raise CalculationError('EXPRESSION_LIMIT', '表达式节点超过 256 个')
    allowed = (ast.Expression, ast.BinOp, ast.UnaryOp, ast.Constant, ast.Name, ast.Call,
               ast.Add, ast.Sub, ast.Mult, ast.Div, ast.Pow, ast.UAdd, ast.USub, ast.Load)

    def check(node, level=0):
        if level > MAX_DEPTH:
            raise CalculationError('EXPRESSION_LIMIT', '表达式嵌套超过 24 层')
        if not isinstance(node, allowed):
            raise CalculationError('UNSAFE_EXPRESSION', f'不支持表达式节点 {type(node).__name__}')
        if isinstance(node, ast.Constant):
            if isinstance(node.value, bool) or not isinstance(node.value, (int, float)) or abs(node.value) > 1e100 or not math.isfinite(node.value):
                raise CalculationError('INVALID_CONSTANT', '仅允许有限数值常量，绝对值不超过 1e100')
        if isinstance(node, ast.Name) and not (identifier(node.id) or node.id in FUNCTIONS | CONSTANTS.keys()):
            raise CalculationError('UNSAFE_EXPRESSION', '非法变量名')
        if isinstance(node, ast.Call) and (not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS or node.keywords or not 1 <= len(node.args) <= 8):
            raise CalculationError('UNSAFE_EXPRESSION', '仅允许白名单函数，不支持关键字参数')
        if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow):
            power = node.right
            if isinstance(power, ast.UnaryOp) and isinstance(power.op, (ast.UAdd, ast.USub)):
                power = power.operand
            if not isinstance(power, ast.Constant) or isinstance(power.value, bool) or not isinstance(power.value, (int, float)) or abs(power.value) > 12:
                raise CalculationError('EXPONENT_LIMIT', '指数必须是绝对值不超过 12 的数值常量')
        for child in ast.iter_child_nodes(node):
            check(child, level + 1)
    check(tree)
    dependencies = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} - FUNCTIONS - CONSTANTS.keys()
    return tree, dependencies


def _function(name, args):
    if name in ('min', 'max'):
        for value in args[1:]:
            args[0].add(value)  # 同时校验量纲和分数口径。
        return (min if name == 'min' else max)(args, key=lambda item: item.value)
    if len(args) != 1:
        raise CalculationError('FUNCTION_ARGUMENTS', f'{name} 需要一个参数')
    q = args[0]
    if name == 'abs':
        return Quantity(abs(q.value), q.dims, q.definition, q.angle_mode, q.meaning_sources)
    if name == 'sqrt':
        return q.power(.5)
    if name in ('radians', 'degrees'):
        expected = 'deg' if name == 'radians' else 'rad'
        if q.dims != (('angle', 1),) or q.angle_mode != expected:
            raise CalculationError('ANGLE_UNIT', f'{name} 需要 {expected} 角度量')
        return Quantity(q.value, q.dims, None, 'rad' if name == 'radians' else 'deg', q.meaning_sources)
    if name in ('sin', 'cos', 'tan'):
        if q.dims != (('angle', 1),) or q.angle_mode != 'rad':
            raise CalculationError('ANGLE_UNIT', '三角函数需要 rad 角度；deg 请先调用 radians')
        if name == 'tan' and abs(math.cos(q.value)) < 1e-15:
            raise CalculationError('DOMAIN_ERROR', 'tan 在此角度无有限值')
        return Quantity(finite(getattr(math, name)(q.value)), meaning_sources=q.meaning_sources)
    if q.dims:
        raise CalculationError('UNIT_MISMATCH', f'{name} 需要无量纲输入')
    try:
        value = finite(getattr(math, name)(q.value))
    except (ValueError, OverflowError) as exc:
        raise CalculationError('DOMAIN_ERROR', f'{name} 的输入超出定义域或结果溢出') from exc
    if name in ('asin', 'acos', 'atan'):
        return Quantity(value, (('angle', 1),), None, 'rad', q.meaning_sources)
    return Quantity(value, meaning_sources=q.meaning_sources)


def evaluate_tree(tree, variables):
    def visit(node):
        if isinstance(node, ast.Expression):
            return visit(node.body)
        if isinstance(node, ast.Constant):
            return Quantity(float(node.value))
        if isinstance(node, ast.Name):
            if node.id in CONSTANTS:
                return CONSTANTS[node.id]
            if node.id not in variables:
                raise CalculationError('UNKNOWN_VARIABLE', f'未知变量 {node.id}')
            value = variables[node.id]
            if isinstance(value, CalculationError):
                raise value
            return value
        if isinstance(node, ast.UnaryOp):
            q = visit(node.operand)
            return Quantity(-q.value if isinstance(node.op, ast.USub) else q.value, q.dims, q.definition, q.angle_mode, q.meaning_sources)
        if isinstance(node, ast.Call):
            return _function(node.func.id, [visit(arg) for arg in node.args])
        left, right = visit(node.left), visit(node.right)
        if isinstance(node.op, ast.Add): return left.add(right)
        if isinstance(node.op, ast.Sub): return left.add(right, -1)
        if isinstance(node.op, ast.Mult): return left.multiply(right)
        if isinstance(node.op, ast.Div): return left.multiply(right, True)
        return left.power(right.value)
    return visit(tree)


def compile_formula(config):
    variables, outputs = config.get('variables', {}), config.get('outputs', [])
    if not isinstance(variables, dict) or len(variables) > 64 or not isinstance(outputs, list) or not 1 <= len(outputs) <= 20:
        raise CalculationError('FORMULA_LIMIT', '最多 64 个变量、1—20 个输出')
    if config.get('scope', 'row') not in ('row', 'sample', 'spectrum'):
        raise CalculationError('GROUPING', '公式执行范围只能为 row、sample 或 spectrum')
    for name, binding in variables.items():
        if not identifier(name) or not isinstance(binding, dict):
            raise CalculationError('INVALID_BINDING', '变量须使用合法名称与绑定对象')
        sources = sum(key in binding for key in ('field', 'metadata', 'value'))
        if sources != 1:
            raise CalculationError('INVALID_BINDING', f'变量 {name} 须明确选择峰字段、元数据或常数之一')
        if binding.get('aggregate') not in (None, '', 'sum', 'mean'):
            raise CalculationError('INVALID_BINDING', '聚合仅支持 sum 或 mean')
        if 'field' in binding:
            if binding['field'] not in ('position', 'width', 'height', 'area'):
                raise CalculationError('INVALID_BINDING', f'变量 {name} 引用了不支持的峰字段')
        elif 'metadata' in binding:
            path = binding['metadata']
            if not isinstance(path, str) or not 1 <= len(path) <= 256 or any(not identifier(part) for part in path.split('.')) or len(path.split('.')) > 8:
                raise CalculationError('INVALID_BINDING', '元数据须用有限层级的明确键名，不支持属性访问或私有名称')
            if 'unit' not in binding:
                raise CalculationError('UNKNOWN_UNIT', '元数据绑定须声明单位')
        else:
            Quantity.from_value(binding.get('value'), binding.get('unit', '1'), binding.get('definition'))
        if 'unit' in binding:
            parse_unit(binding['unit'])
    definitions = {}
    for output in outputs:
        if not isinstance(output, dict) or not identifier(output.get('name')) or output['name'] in variables or output['name'] in definitions:
            raise CalculationError('DUPLICATE_OUTPUT', '输出名称非法、重复或覆盖输入变量')
        parse_unit(output.get('unit', '1'))
        tree, dependencies = parse_expression(output.get('expression'))
        definitions[output['name']] = (output, tree, dependencies)
    available = set(variables) | set(definitions)
    order, visiting, visited = [], set(), set()

    def walk(name):
        if name in visited: return
        if name in visiting: raise CalculationError('CYCLIC_DEPENDENCY', f'输出 {name} 存在循环依赖')
        visiting.add(name)
        for dependency in definitions[name][2]:
            if dependency not in available:
                raise CalculationError('UNKNOWN_VARIABLE', f'输出 {name} 引用了未知变量 {dependency}')
            if dependency in definitions: walk(dependency)
        visiting.remove(name); visited.add(name); order.append(name)
    for name in definitions: walk(name)
    return variables, definitions, order


def _bound_quantity(record, binding):
    if 'metadata' in binding:
        data = record.get('metadata', {})
        for part in binding['metadata'].split('.'):
            if not isinstance(data, dict) or part not in data:
                raise CalculationError('MISSING_VALUE', f'缺少元数据 {binding["metadata"]}')
            data = data[part]
        source = data if isinstance(data, dict) else {'value': data, 'unit': binding['unit'], 'definition': binding.get('definition')}
    elif 'field' in binding:
        source = record.get('fields', {}).get(binding['field'], {})
    else:
        source = binding
    if not isinstance(source, dict):
        raise CalculationError('INVALID_BINDING', '绑定的数据须为数值或数量对象')
    q = Quantity.from_value(source.get('value'), source.get('unit', 'unknown'), source.get('definition'))
    if ('field' in binding or 'metadata' in binding) and binding.get('unit'):
        q = Quantity.from_value(q.output(binding['unit'])['value'], binding['unit'], q.definition)
    if binding.get('expected_definition') and source.get('definition') != binding['expected_definition']:
        raise CalculationError('DEFINITION_MISMATCH', '变量绑定的数量定义不符')
    return q, source.get('definition')


def evaluate_formula(record, compiled):
    records = record if isinstance(record, list) else [record]
    bindings, definitions, order = compiled
    variables, values, issues = {}, {}, []
    for name, binding in bindings.items():
        try:
            selected = records if 'field' in binding or 'metadata' in binding else records[:1]
            bound = [_bound_quantity(item, binding) for item in selected]
            quantities = [q for q, _ in bound]
            if len({definition for _, definition in bound}) > 1:
                raise CalculationError('DEFINITION_MISMATCH', '组内数量定义不同，不能将区间／全域面积等直接聚合')
            for q in quantities[1:]: quantities[0].add(q)
            aggregation = binding.get('aggregate')
            if aggregation:
                total = quantities[0]
                for q in quantities[1:]: total = total.add(q)
                variables[name] = total.multiply(Quantity(len(quantities)), True) if aggregation == 'mean' else total
            elif len(quantities) > 1 and ('field' in binding or any(q != quantities[0] for q in quantities[1:])):
                raise CalculationError('AMBIGUOUS_GROUP_VALUE', f'组内变量 {name} 需明确 sum/mean 聚合，或一致的共同元数据')
            else:
                variables[name] = quantities[0]
        except CalculationError as exc:
            variables[name] = exc
    for name in order:
        output, tree, _ = definitions[name]
        try:
            q = evaluate_tree(tree, variables)
            values[name] = q.output(output.get('unit', '1'), output.get('definition'))
            variables[name] = q
        except CalculationError as exc:
            variables[name] = exc
            values[name] = {'value': None, 'unit': output.get('unit', '1')}
            issues.append({**exc.as_dict(), 'path': f'outputs.{name}'})
    return values, issues
