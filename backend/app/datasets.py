"""Import and select local tabular XY datasets."""

from __future__ import annotations

import csv
from dataclasses import dataclass
from io import BytesIO, StringIO
from itertools import chain
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
    if not prepared.columns.is_unique:
        raise ValueError("列名重复，请为每列设置唯一的表头")
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


def _numeric_first_row(row) -> bool:
    values = pd.to_numeric(pd.Series(row), errors="coerce")
    return len(values) >= 2 and values.notna().all()


def _headerless_column_names(column_count: int) -> list[str]:
    """Keep headerless instrument exports neutral until the user assigns X and Y."""
    return [f"第{index}列" for index in range(1, column_count + 1)]


def _table_delimiter(lines: list[str]) -> str:
    # 列名可以跨行或含其他分隔符，结合下一条完整记录识别实际分隔符。
    fallback = None
    for delimiter in (",", "\t", ";", "|"):
        try:
            records = _text_records(lines, delimiter)
            first = next(records)
            if len(first) < 2:
                continue
            fallback = fallback or delimiter
            following = next(records, None)
            if following is None or len(following) == len(first):
                return delimiter
        except csv.Error:
            continue
    return fallback or " "


def _text_records(lines: list[str], delimiter: str):
    source = iter(lines)
    for line in source:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", "//")):
            continue
        if stripped.startswith(";"):
            if delimiter != ";":
                continue
            # 保留以空 X 开头的分号分隔数据，识别单独成行的 “; 注释”。
            if stripped.startswith("; ") and ";" not in stripped[1:]:
                try:
                    float(stripped[1:])
                except ValueError:
                    continue
        if delimiter == " ":
            line = stripped + "\n"
        # 让读取器消费完整记录；字段中的换行和注释符属于原始单元格。
        yield next(csv.reader(chain([line], source), delimiter=delimiter,
                              skipinitialspace=delimiter == " ", strict=True))


def _read_text_table(content: bytes) -> pd.DataFrame:
    if _looks_binary(content):
        raise ValueError("检测到二进制内容；请导出为 TXT、CSV、XY 或 XYE 文本表格，或提供对应仪器解析器。")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = content.decode("gb18030")
        except UnicodeDecodeError as exc:
            raise ValueError("无法读取文本编码；请使用 UTF-8 或 GB18030") from exc
    lines = text.splitlines(keepends=True)
    comments = ("#", ";", "//")
    start = next((i for i, line in enumerate(lines) if line.strip() and not line.strip().startswith(comments)), None)
    if start is None:
        raise ValueError("文件为空或只含注释，没有可导入的数据行")
    declared = _comment_declared_columns(lines[:start])
    data_lines = lines[start:]
    delimiter = _table_delimiter(data_lines)
    try:
        reader = _text_records(data_lines, delimiter)
        first = next(reader)
        expected = len(declared) if declared else len(first)
        if expected < 2:
            raise ValueError("未识别出至少两列，请检查文件分隔符")
        table = StringIO()
        writer = csv.writer(table)
        for row_number, row in enumerate(chain([first], reader), 1):
            if len(row) != expected:
                raise ValueError(f"第 {row_number} 条记录的列数不符：预期 {expected} 列，实际 {len(row)} 列")
            writer.writerow(row)
        names = declared or (_headerless_column_names(expected) if _numeric_first_row(first) else None)
        table.seek(0)
        return pd.read_csv(table, header=0 if names is None else None, names=names)
    except (csv.Error, pd.errors.ParserError) as exc:
        raise ValueError("无法读取文本文件；请检查分隔符及引号是否匹配") from exc


def _read_excel_workbook(suffix: str, content: bytes) -> dict[object, pd.DataFrame]:
    engine = "xlrd" if suffix == ".xls" else "openpyxl"
    try:
        with pd.ExcelFile(BytesIO(content), engine=engine) as workbook:
            frames = {}
            for sheet in workbook.sheet_names:
                first = workbook.parse(sheet, header=None, nrows=1)
                headerless = not first.empty and _numeric_first_row(first.iloc[0])
                frame = workbook.parse(sheet, header=None if headerless else 0)
                if headerless:
                    frame.columns = _headerless_column_names(len(frame.columns))
                frames[sheet] = frame
            return frames
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
        frames = {"数据": _read_text_table(content)}
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
