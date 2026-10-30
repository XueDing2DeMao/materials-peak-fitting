"""受限单位语法；角度和不同分数口径保留独立含义。"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass

from .errors import CalculationError


def finite(value, name='数值') -> float:
    if value is None:
        raise CalculationError('MISSING_VALUE', f'{name}缺失')
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise CalculationError('INVALID_NUMBER', f'{name}必须为数值')
    try:
        result = float(value)
    except (ValueError, OverflowError) as exc:
        raise CalculationError('NONFINITE', f'{name}超出有限数值范围') from exc
    if not math.isfinite(result):
        raise CalculationError('NONFINITE', f'{name}不是有限数值')
    return result


def dimensions(mapping):
    return tuple(sorted((key, round(value, 12)) for key, value in mapping.items() if abs(value) > 1e-12))


def combine(left, right, sign=1):
    result = dict(left)
    for key, value in right:
        result[key] = result.get(key, 0) + sign * value
    return dimensions(result)


@dataclass(frozen=True)
class Unit:
    scale: float
    dims: tuple
    symbol: str


_BASE = {
    '1': (1., {}), '%': (.01, {}), 'ppm': (1e-6, {}), 'microstrain': (1e-6, {}),
    'm': (1., {'L': 1}), 'cm': (.01, {'L': 1}), 'mm': (.001, {'L': 1}),
    'um': (1e-6, {'L': 1}), 'nm': (1e-9, {'L': 1}), 'angstrom': (1e-10, {'L': 1}),
    'rad': (1., {'angle': 1}), 'deg': (math.pi / 180, {'angle': 1}),
    'eV': (1., {'E': 1}), 'keV': (1000., {'E': 1}),
    'kg': (1., {'M': 1}), 'g': (.001, {'M': 1}), 'mg': (1e-6, {'M': 1}), 'ug': (1e-9, {'M': 1}),
    'L': (.001, {'L': 3}), 'mL': (1e-6, {'L': 3}), 'uL': (1e-9, {'L': 3}),
    'mol': (1., {'N': 1}), 'mmol': (.001, {'N': 1}),
    's': (1., {'T': 1}), 'min': (60., {'T': 1}),
    'K': (1., {'temperature': 1}), 'Pa': (1., {'pressure': 1}), 'MPa': (1e6, {'pressure': 1}),
    'counts': (1., {'counts': 1}), 'count': (1., {'counts': 1}),
    'a.u.': (1., {'arbitrary_intensity': 1}), 'au': (1., {'arbitrary_intensity': 1}),
    'absorbance': (1., {'absorbance': 1}), 'Abs': (1., {'absorbance': 1}),
}
_ALIASES = {'': '1', 'dimensionless': '1', '无量纲': '1', '°': 'deg', 'degree': 'deg',
            'degrees': 'deg', 'radian': 'rad', 'radians': 'rad', 'Å': 'angstrom', 'A': 'angstrom',
            'µε': 'microstrain', 'με': 'microstrain', 'a.u': 'a.u.', 'arb.': 'a.u.', 'cps': 'counts/s'}
_TOKEN = re.compile(r'custom:[A-Za-z][A-Za-z0-9_]{0,31}|[A-Za-z][A-Za-z0-9.]*|[+-]?\d+|[%*/^()]')
_FRACTIONS = {'mass_fraction', 'mole_fraction', 'atomic_fraction', 'volume_fraction', 'strain'}


def parse_unit(text: str) -> Unit:
    if not isinstance(text, str) or len(text) > 160:
        raise CalculationError('UNKNOWN_UNIT', '单位名称缺失或过长')
    text = _ALIASES.get(text.strip(), text.strip())
    text = text.replace('·', '*').replace('×', '*').replace('⁻¹', '^-1').replace('⁻²', '^-2').replace('²', '^2').replace('³', '^3')
    text = text.replace('μ', 'u').replace('µ', 'u').replace('Å', 'angstrom').replace('°', 'deg').replace(' ', '')
    if text in ('unknown', '未知', '?'):
        raise CalculationError('UNKNOWN_UNIT', '未知单位不能参与计算')
    if text.count('(') > 8:
        raise CalculationError('UNIT_LIMIT', '单位括号层数超限')
    tokens = _TOKEN.findall(text)
    if not tokens or ''.join(tokens) != text or len(tokens) > 48:
        raise CalculationError('UNKNOWN_UNIT', f'不支持单位 {text}')
    index = 0

    def atom(depth=0):
        nonlocal index
        if depth > 8 or index >= len(tokens):
            raise CalculationError('UNKNOWN_UNIT', '单位表达式不完整')
        token = tokens[index]; index += 1
        if token == '(':
            scale, dims = product(depth + 1)
            if index >= len(tokens) or tokens[index] != ')':
                raise CalculationError('UNKNOWN_UNIT', '单位括号不匹配')
            index += 1
        elif token in _BASE:
            scale, mapping = _BASE[token]; dims = dimensions(mapping)
        elif token.startswith('custom:'):
            scale, dims = 1., ((token, 1),)
        else:
            raise CalculationError('UNKNOWN_UNIT', f'不支持单位 {token}；自定义单位使用 custom:名称')
        if index < len(tokens) and tokens[index] == '^':
            index += 1
            if index >= len(tokens) or not re.fullmatch(r'[+-]?\d+', tokens[index]):
                raise CalculationError('UNKNOWN_UNIT', '单位幂必须为整数')
            exponent = int(tokens[index]); index += 1
            if abs(exponent) > 12:
                raise CalculationError('UNIT_LIMIT', '单位指数超限')
            try:
                scale **= exponent
            except (OverflowError, ZeroDivisionError) as exc:
                raise CalculationError('UNIT_LIMIT', '复合单位换算因子超出有限范围') from exc
            if not math.isfinite(scale) or scale <= 0:
                raise CalculationError('UNIT_LIMIT', '复合单位换算因子超出有限范围')
            dims = dimensions({k: v * exponent for k, v in dims})
        return scale, dims

    def product(depth=0):
        nonlocal index
        scale, dims = atom(depth)
        while index < len(tokens) and tokens[index] in ('*', '/'):
            operator = tokens[index]; index += 1
            other_scale, other_dims = atom(depth)
            sign = 1 if operator == '*' else -1
            try:
                scale *= other_scale ** sign
            except (OverflowError, ZeroDivisionError) as exc:
                raise CalculationError('UNIT_LIMIT', '复合单位换算因子超出有限范围') from exc
            if not math.isfinite(scale) or scale <= 0:
                raise CalculationError('UNIT_LIMIT', '复合单位换算因子超出有限范围')
            dims = combine(dims, other_dims, sign)
        return scale, dims

    scale, dims = product()
    if index != len(tokens) or not math.isfinite(scale) or scale <= 0:
        raise CalculationError('UNKNOWN_UNIT', f'不支持单位 {text}')
    return Unit(scale, dims, text)


@dataclass(frozen=True)
class Quantity:
    value: float  # 内部统一基准单位数值
    dims: tuple = ()
    definition: str | None = None
    angle_mode: str | None = None
    meaning_sources: frozenset[str] = frozenset()

    @classmethod
    def from_value(cls, value, unit='1', definition=None):
        if definition is not None and not isinstance(definition, str):
            raise CalculationError('INVALID_QUANTITY', '数量定义须为文本')
        parsed = parse_unit(unit)
        base = finite(value) * parsed.scale
        finite(base)
        return cls(base, parsed.dims, definition if definition in _FRACTIONS else None,
                   parsed.symbol if parsed.symbol in ('deg', 'rad') else None,
                   frozenset({definition}) if definition in _FRACTIONS else frozenset())

    def output(self, unit, definition=None):
        if definition is not None and not isinstance(definition, str):
            raise CalculationError('INVALID_QUANTITY', '输出数量定义须为文本')
        target = parse_unit(unit)
        if self.dims != target.dims:
            raise CalculationError('UNIT_MISMATCH', f'结果量纲与输出单位 {unit} 不一致')
        if definition in _FRACTIONS and ((self.definition and definition != self.definition) or self.meaning_sources - {definition}):
            raise CalculationError('MEANING_MISMATCH', '不能把不同分数或应变口径静默互换')
        return {'value': finite(self.value / target.scale), 'unit': unit,
                **({'definition': definition or self.definition} if definition or self.definition else {})}

    def add(self, other, sign=1):
        if self.dims != other.dims:
            raise CalculationError('UNIT_MISMATCH', '加减运算要求相同量纲')
        if self.definition and other.definition and self.definition != other.definition:
            raise CalculationError('MEANING_MISMATCH', '质量、摩尔、原子及体积分数不可直接相加减')
        if self.meaning_sources and other.meaning_sources and self.meaning_sources != other.meaning_sources:
            raise CalculationError('MEANING_MISMATCH', '不同分数口径的派生量不可直接相加减')
        return Quantity(finite(self.value + sign * other.value), self.dims, self.definition or other.definition,
                        self.angle_mode, self.meaning_sources | other.meaning_sources)

    def multiply(self, other, divide=False):
        if divide and other.value == 0:
            raise CalculationError('DIVISION_BY_ZERO', '除数为零')
        value = self.value / other.value if divide else self.value * other.value
        dims = combine(self.dims, other.dims, -1 if divide else 1)
        meaning = self.definition if not other.dims and not other.definition else None
        angle = self.angle_mode if dims == (('angle', 1),) and not other.dims else None
        if not divide and not self.dims and not self.definition:
            meaning = other.definition
            if dims == (('angle', 1),): angle = other.angle_mode
        return Quantity(finite(value), dims, meaning, angle, self.meaning_sources | other.meaning_sources)

    def power(self, exponent):
        if self.value < 0 and exponent != int(exponent):
            raise CalculationError('DOMAIN_ERROR', '负数不能执行非整数实数幂')
        if self.value == 0 and exponent < 0:
            raise CalculationError('DIVISION_BY_ZERO', '零不能取负指数')
        try:
            return Quantity(finite(self.value ** exponent), dimensions({k: v * exponent for k, v in self.dims}),
                            self.definition if exponent == 1 else None, self.angle_mode if exponent == 1 else None,
                            self.meaning_sources)
        except OverflowError as exc:
            raise CalculationError('NONFINITE', '幂运算溢出') from exc


def convert(value, source_unit, target_unit):
    return Quantity.from_value(value, source_unit).output(target_unit)['value']
