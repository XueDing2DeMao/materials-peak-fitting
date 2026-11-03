"""识别源表头明确注明的单位，不对数据作隐式换算。"""
import re


_KNOWN = re.compile(r'°|deg|rad|eV|meV|keV|cm(?:\^?-1|⁻¹)|1/cm|nm|µm|μm|um|mm|Å|s|ms|ns|ps|'
                    r'Hz|kHz|MHz|GHz|THz|a\.?\s?u\.?|arb\.?\s?units?|counts?|counts?/s|cps|%|mV|V|mA|A|W|mW|度|计数', re.I)


def column_unit(column: str) -> str:
    text = column.strip()
    suffix = re.search(r'(?:\[([^\]]+)\]|\(([^)]+)\)|（([^）]+)）|\s/\s*(.+))\s*$', text)
    candidate = next((part.strip() for part in suffix.groups() if part), text) if suffix else text
    return candidate if _KNOWN.fullmatch(candidate) else ''


def validate_axis_unit(mode: str, column: str) -> None:
    unit = column_unit(column)
    if not unit or mode == 'general':
        return
    allowed = {'deg', '°', '度'} if mode == 'xrd' else {'ev'}
    if unit.lower() not in allowed:
        expected = 'XRD 需要角度（°）' if mode == 'xrd' else 'XPS 需要电子伏（eV）'
        raise ValueError(f'X 列“{column}”的单位为 {unit}，{expected}。请先换算数据或选择单位正确的 X 列。')
