"""可选选列审计；保留 select_xy 的原始数值与稳定排序语义。"""
from __future__ import annotations

import numpy as np
import pandas as pd
from .datasets import ParsedWorkbook, select_xy


def select_xy_audited(workbook: ParsedWorkbook, sheet_name: str | None, x_column: str, y_column: str):
    x, y = select_xy(workbook, sheet_name, x_column, y_column)
    sheet = next(s for s in workbook.sheets if s.name == (sheet_name or workbook.sheets[0].name))
    numeric = {key: pd.to_numeric(sheet.frame[column], errors="coerce").to_numpy(dtype=float)
               for key, column in [("x", x_column), ("y", y_column)]}
    valid = np.isfinite(numeric["x"]) & np.isfinite(numeric["y"])
    reasons: dict[str, int] = {}
    excluded = []
    for position in np.flatnonzero(~valid):
        row_reasons = []
        for key, column in [("x", x_column), ("y", y_column)]:
            raw = sheet.frame.iloc[position][column]
            if pd.isna(raw) or isinstance(raw, str) and not raw.strip():
                reason = f"{key}_missing"
            elif np.isnan(numeric[key][position]):
                reason = f"{key}_non_numeric"
            elif not np.isfinite(numeric[key][position]):
                reason = f"{key}_non_finite"
            else:
                continue
            row_reasons.append(reason)
            reasons[reason] = reasons.get(reason, 0) + 1
        if len(excluded) < 200:
            excluded.append({"parsed_row": int(sheet.frame.index[position]) + 1, "reasons": row_reasons})
    positions = np.flatnonzero(valid)
    order = np.argsort(numeric["x"][valid], kind="stable")
    return x, y, {
        "version": 1,
        "row_basis": "parsed_sheet_after_empty_rows_removed",
        "sheet_rows": len(sheet.frame), "valid_pairs": len(x),
        "excluded_pairs": int((~valid).sum()), "exclusion_reasons": reasons,
        "excluded_rows": excluded, "excluded_rows_truncated": int((~valid).sum()) > 200,
        "source_rows": [int(sheet.frame.index[i]) + 1 for i in positions[order]],
        "sorting_changed": not np.array_equal(order, np.arange(len(order))),
        "duplicate_x_count": len(x) - len(np.unique(x)),
    }
