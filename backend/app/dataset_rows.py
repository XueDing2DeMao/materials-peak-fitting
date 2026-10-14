"""只读浏览解析工作表，不做 X/Y 有效性筛选或排序。"""
from datetime import date, datetime
from numbers import Integral, Real
import math

import numpy as np
import pandas as pd

from .datasets import ParsedWorkbook


def _cell(value):
    if value is None or pd.isna(value):
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, Integral):
        return int(value)
    if isinstance(value, Real):
        return float(value) if math.isfinite(value) else ('Infinity' if value > 0 else '-Infinity')
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


def dataset_page(workbook: ParsedWorkbook, sheet_name: str, offset: int = 0, limit: int = 100) -> dict:
    if offset < 0 or not 1 <= limit <= 500:
        raise ValueError('分页范围无效：起点须非负，每页 1–500 行')
    sheet = next((s for s in workbook.sheets if s.name == sheet_name), None)
    if sheet is None:
        raise ValueError('工作表不存在')
    frame = sheet.frame.iloc[offset:offset + limit]
    return {
        'sheet': sheet.name, 'columns': [str(c) for c in frame.columns],
        'offset': offset, 'limit': limit, 'total_rows': len(sheet.frame),
        'row_numbers': [int(i) + 1 for i in frame.index],
        'rows': [[_cell(v) for v in row] for row in frame.itertuples(index=False, name=None)],
    }
