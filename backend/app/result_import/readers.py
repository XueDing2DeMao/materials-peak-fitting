"""结果表只读读取；保留空行、物理位置，不执行工作簿公式或宏。"""
from __future__ import annotations

import csv
import hashlib
import io
import math
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import Any

MAX_UPLOAD_BYTES = 25 * 1024 * 1024
MAX_ROWS = 100000
MAX_CELLS = 1000000


@dataclass
class ResultSheet:
    name: str
    rows: list[list[Any]]
    locations: list[dict]
    cell_issues: dict[tuple[int, int], str] = field(default_factory=dict)


@dataclass
class ResultWorkbook:
    filename: str
    file_sha256: str
    sheets: list[ResultSheet]
    kind: str


def cell_scalar(v):
    if isinstance(v, (date, datetime)): return v.isoformat()
    if isinstance(v, float) and not math.isfinite(v): return str(v)
    if v is None or isinstance(v, (str, float, int, bool)): return v
    return str(v)


def _check_size(rows, count):
    if len(rows) > MAX_ROWS or count > MAX_CELLS: raise ValueError('表格超过 100000 行或 1000000 单元格，请分批导入')


def read_result_file(filename: str, content: bytes) -> ResultWorkbook:
    if not content: raise ValueError('文件为空')
    if len(content) > MAX_UPLOAD_BYTES: raise ValueError('文件不能超过 25 MiB')
    suffix = Path(filename).suffix.lower()
    sheets = []
    if suffix in {'.csv', '.txt', '.tsv', '.dat'}:
        if b'\x00' in content[:8192]: raise ValueError('文本文件包含二进制内容')
        text = None
        for encoding in ('utf-8-sig', 'gb18030'):
            try: text = content.decode(encoding); break
            except UnicodeDecodeError: pass
        if text is None: raise ValueError('文本编码不可识别，请导出 UTF-8 或 GB18030')
        # 标题行可能只有一个单元格；按含分隔符的行识别，不丢弃标题和空行。
        sample = '\n'.join(line for line in text.splitlines()[:100] if any(d in line for d in (',', '\t', ';', '|')))
        try: dialect = csv.Sniffer().sniff(sample, delimiters=',\t;|')
        except csv.Error:
            dialect = csv.excel_tab if suffix == '.tsv' else csv.excel
        reader = csv.reader(io.StringIO(text, newline=''), dialect=dialect, strict=True)
        rows, locations, last, count = [], [], 0, 0
        try:
            for i, row in enumerate(reader, 1):
                rows.append(row); count += len(row); _check_size(rows, count)
                locations.append({'row': i, 'record_number': i, 'physical_line_start': last + 1, 'physical_line_end': reader.line_num})
                last = reader.line_num
        except csv.Error as exc: raise ValueError(f'CSV 格式错误：{exc}') from exc
        sheets.append(ResultSheet('数据', rows, locations))
    elif suffix in {'.xlsx', '.xlsm'}:
        from openpyxl import load_workbook
        try:
            values = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
            formulas = load_workbook(io.BytesIO(content), read_only=True, data_only=False)
            count = 0
            try:
                for s in values.worksheets:
                    if s.max_row and s.max_row > MAX_ROWS or s.max_column and s.max_column > 1000:
                        raise ValueError('Excel 表格尺寸超过限制')
                    rows, issues = [], {}
                    for r, (line, raw) in enumerate(zip(s.iter_rows(), formulas[s.title].iter_rows()), 1):
                        rows.append([cell_scalar(c.value) for c in line]); count += len(line); _check_size(rows, count)
                        for c, (cached, original) in enumerate(zip(line, raw)):
                            if original.data_type == 'f' and cached.value is None:
                                issues[r, c] = '公式没有已保存缓存值；请在原软件重新保存或导出数值'
                    sheets.append(ResultSheet(s.title, rows, [{'row': i} for i in range(1, len(rows)+1)], issues))
            finally: values.close(); formulas.close()
        except ValueError: raise
        except Exception as exc: raise ValueError('无法读取 Excel 结果文件，请核对格式和完整性') from exc
    elif suffix == '.xls':
        import xlrd
        try:
            book = xlrd.open_workbook(file_contents=content, on_demand=True)
            count = 0
            try:
                for s in book.sheets():
                    if s.nrows > MAX_ROWS or s.ncols > 1000: raise ValueError('XLS 表格尺寸超过限制')
                    rows = []
                    for r in range(s.nrows):
                        row = []
                        for c in range(s.ncols):
                            cell = s.cell(r, c)
                            v = cell.value
                            if cell.ctype == xlrd.XL_CELL_DATE: v = xlrd.xldate.xldate_as_datetime(v, book.datemode).isoformat()
                            if cell.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK): v = None
                            if cell.ctype == xlrd.XL_CELL_ERROR: v = f'Excel error {v}'
                            row.append(cell_scalar(v))
                        rows.append(row); count += len(row); _check_size(rows, count)
                    sheets.append(ResultSheet(s.name, rows, [{'row': i} for i in range(1, len(rows)+1)]))
            finally: book.release_resources()
        except ValueError: raise
        except Exception as exc: raise ValueError('无法读取 XLS 结果文件，请核对格式和完整性') from exc
    else: raise ValueError('结果表支持 CSV、TXT、TSV、DAT、XLSX、XLS、XLSM')
    if not sheets or not any(s.rows for s in sheets): raise ValueError('文件没有可读取的表格')
    return ResultWorkbook(filename, hashlib.sha256(content).hexdigest(), sheets, suffix.removeprefix('.'))


def select_sheet(book: ResultWorkbook, name: str) -> ResultSheet:
    sheet = next((s for s in book.sheets if s.name == name), None)
    if sheet is None: raise ValueError('找不到结果工作表')
    return sheet


def headers(sheet: ResultSheet, header_row: int = 1):
    if not 1 <= header_row <= len(sheet.rows): raise ValueError('表头行超出工作表范围')
    return [str(v).strip() if v is not None and str(v).strip() else f'第{i+1}列' for i, v in enumerate(sheet.rows[header_row-1])]


def table_page(book: ResultWorkbook, sheet: str, offset: int = 0, limit: int = 100, header_row: int = 1) -> dict:
    if offset < 0 or not 1 <= limit <= 500: raise ValueError('分页范围无效；每页 1–500 行')
    s = select_sheet(book, sheet); columns = headers(s, header_row)
    start = header_row + offset
    selected = s.rows[start:start+limit]
    return {'sheet': sheet, 'columns': columns, 'offset': offset, 'limit': limit, 'total_rows': max(0, len(s.rows)-header_row),
            'row_numbers': [v['row'] for v in s.locations[start:start+limit]], 'rows': selected,
            'locations': s.locations[start:start+limit]}
