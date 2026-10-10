"""Import and select local tabular XY datasets."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO, StringIO
from pathlib import Path
import re

import numpy as np
import pandas as pd
from numpy.typing import NDArray


TEXT_TABLE_SUFFIXES = {".csv", ".txt", ".tsv", ".dat", ".xy", ".xye"}
EXCEL_SUFFIXES = {".xls", ".xlsx", ".xlsm"}


@dataclass(slots=True)
class ParsedSheet:
    name: str
    frame: pd.DataFrame
    numeric_columns: list[str]


@dataclass(slots=True)
class ParsedWorkbook:
    filename: str
    sheets: list[ParsedSheet]


def _prepare_frame(frame: pd.DataFrame) -> pd.DataFrame:
    prepared = frame.copy()
    prepared.columns = [str(column).strip() or f"列{index + 1}" for index, column in enumerate(prepared.columns)]
    return prepared.dropna(axis=1, how="all").dropna(axis=0, how="all")


def _numeric_columns(frame: pd.DataFrame) -> list[str]:
    return [
        str(column)
        for column in frame.columns
        if pd.to_numeric(frame[column], errors="coerce").notna().sum() >= 2
    ]


def _looks_binary(content: bytes) -> bool:
    """Reject binary instrument exports before a permissive text decoder misreads them."""
    sample = content[:8192]
    if not sample:
        return False
    if b"\x00" in sample:
        return True
    controls = sum(byte < 32 and byte not in {9, 10, 13, 12} for byte in sample)
    return controls / len(sample) > 0.05


def _comment_declared_columns(lines: list[str]) -> list[str] | None:
    """Read labels such as ``# Columns: 2theta intensity`` from instrument exports."""
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith(("#", ";", "//")):
            continue
        comment = stripped.removeprefix("#").removeprefix(";").removeprefix("//").strip()
        match = re.match(r"(?:columns?|fields?)\s*[:=]\s*(.+)$", comment, flags=re.IGNORECASE)
        if not match:
            continue
        columns = [value for value in re.split(r"[\s,;\t]+", match.group(1).strip()) if value]
        if len(columns) >= 2:
            return columns
    return None


def _column_labels_are_numeric(frame: pd.DataFrame) -> bool:
    """Detect the false header created when a headerless numeric file is read normally."""
    labels = pd.to_numeric(pd.Index(frame.columns), errors="coerce")
    return len(labels) >= 2 and labels.notna().all()


def _headerless_column_names(column_count: int) -> list[str]:
    """Keep headerless instrument exports neutral until the user assigns X and Y."""
    return [f"第{index}列" for index in range(1, column_count + 1)]


def _read_text_table(suffix: str, content: bytes) -> pd.DataFrame:
    if _looks_binary(content):
        raise ValueError("检测到二进制内容；请导出为 TXT、CSV、XY 或 XYE 文本表格，或提供对应仪器解析器。")
    error: Exception | None = None
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            text = content.decode(encoding)
            lines = text.splitlines()
            declared_columns = _comment_declared_columns(lines)
            data = "\n".join(line for line in lines if not line.strip().startswith(("#", ";", "//")))
            if declared_columns:
                return pd.read_csv(StringIO(data), sep=None, engine="python", header=None, names=declared_columns)
            with_header = pd.read_csv(StringIO(data), sep=None, engine="python")
            if (
                len(_numeric_columns(_prepare_frame(with_header))) >= 2
                and not _column_labels_are_numeric(with_header)
            ):
                return with_header
            without_header = pd.read_csv(StringIO(data), sep=None, engine="python", header=None)
            without_header.columns = _headerless_column_names(len(without_header.columns))
            return without_header
        except (UnicodeDecodeError, pd.errors.ParserError) as exc:
            error = exc
    raise ValueError("无法读取文本文件；请确认编码、表头和分隔符") from error


def _read_excel_workbook(suffix: str, content: bytes) -> dict[object, pd.DataFrame]:
    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    try:
        return pd.read_excel(BytesIO(content), sheet_name=None, engine=engine)
    except ImportError as exc:
        if suffix == ".xls":
            raise ValueError("读取旧版 XLS 需要 xlrd；请安装 requirements.txt 中的依赖后重试。") from exc
        raise ValueError("无法读取 Excel 文件；请确认文件未损坏。") from exc
    except Exception as exc:
        label = suffix.removeprefix(".").upper()
        raise ValueError(f"无法读取 {label} 文件；请确认文件未损坏或已正确导出。") from exc


def parse_upload(filename: str, content: bytes) -> ParsedWorkbook:
    """Parse a local materials table or Excel workbook without persisting it to disk."""
    suffix = Path(filename).suffix.lower()
    if suffix in TEXT_TABLE_SUFFIXES:
        frames = {"数据": _read_text_table(suffix, content)}
    elif suffix in EXCEL_SUFFIXES:
        frames = _read_excel_workbook(suffix, content)
    else:
        raise ValueError("仅支持表格或文本数据：CSV、TXT、TSV、DAT、XY、XYE、XLS、XLSX、XLSM。")

    sheets = [
        ParsedSheet(name=str(name), frame=_prepare_frame(frame), numeric_columns=_numeric_columns(_prepare_frame(frame)))
        for name, frame in frames.items()
    ]
    if not sheets or not any(sheet.numeric_columns for sheet in sheets):
        raise ValueError("文件中没有可用的数值列")
    return ParsedWorkbook(filename=filename, sheets=sheets)


def select_xy(
    workbook: ParsedWorkbook, sheet_name: str | None, x_column: str, y_column: str
) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    """Return finite, X-sorted numeric values for the selected columns."""
    if x_column == y_column:
        raise ValueError("X 列和 Y 列不能相同")
    selected = next((sheet for sheet in workbook.sheets if sheet.name == (sheet_name or workbook.sheets[0].name)), None)
    if selected is None:
        raise ValueError("找不到所选工作表")
    if x_column not in selected.frame.columns or y_column not in selected.frame.columns:
        raise ValueError("找不到所选的 X/Y 列")

    paired = pd.DataFrame(
        {
            "x": pd.to_numeric(selected.frame[x_column], errors="coerce"),
            "y": pd.to_numeric(selected.frame[y_column], errors="coerce"),
        }
    ).replace([np.inf, -np.inf], np.nan).dropna()
    if len(paired) < 2:
        raise ValueError("所选 X/Y 列至少需要两行有效数值")
    paired = paired.sort_values("x", kind="stable")
    return paired["x"].to_numpy(dtype=float), paired["y"].to_numpy(dtype=float)
