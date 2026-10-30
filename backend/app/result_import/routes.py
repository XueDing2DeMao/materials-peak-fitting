"""结果导入的独立 HTTP 接口；短期内存缓存，不覆盖原文件。"""
from __future__ import annotations

from dataclasses import dataclass
from time import monotonic
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import Field

from ..peak_records import StrictRecord, adapt_internal_result
from .mapping import ResultMapping, suggest_mapping
from .normalize import normalize_result
from .readers import MAX_UPLOAD_BYTES, ResultWorkbook, read_result_file, table_page

router = APIRouter(prefix='/api/peak-results', tags=['峰结果解析'])
TTL_SECONDS = 3600
MAX_CACHED_UPLOADS = 40


@dataclass
class CachedUpload:
    book: ResultWorkbook
    created: float


_uploads: dict[str, CachedUpload] = {}


def _expire():
    now = monotonic()
    for key, value in list(_uploads.items()):
        if now-value.created > TTL_SECONDS: del _uploads[key]


def _book(upload_id):
    _expire()
    if upload_id not in _uploads: raise HTTPException(404, '结果文件缓存已失效，请重新上传')
    return _uploads[upload_id].book


class NormalizePayload(StrictRecord):
    upload_id: str
    mapping: ResultMapping


class InternalResultPayload(StrictRecord):
    engine: Literal['single', 'multi', 'xps']
    result: dict[str, Any]
    source: dict[str, Any] | None = None
    mode: Literal['general', 'xrd', 'raman', 'ftir', 'xps'] = 'general'
    metadata: dict[str, Any] = Field(default_factory=dict)


@router.post('/uploads')
async def upload_results(file: UploadFile = File(...), header_row: int = Query(1, ge=1)):
    content = await file.read(MAX_UPLOAD_BYTES+1)
    if len(content) > MAX_UPLOAD_BYTES: raise HTTPException(413, '文件不能超过 25 MiB')
    try:
        book = read_result_file(file.filename or 'results.csv', content)
        sheets = []
        for sheet in book.sheets:
            if len(sheet.rows) < header_row:
                sheets.append({'name': sheet.name, 'columns': [], 'row_count': 0, 'preview_rows': [], 'row_numbers': []}); continue
            page = table_page(book, sheet.name, limit=5, header_row=header_row)
            sheets.append({'name': sheet.name, 'columns': page['columns'], 'row_count': page['total_rows'], 'preview_rows': page['rows'], 'row_numbers': page['row_numbers']})
        first = next((s for s in sheets if s['columns']), None)
        if first is None: raise ValueError('所有工作表都没有所选表头行')
        suggestion = suggest_mapping(book, first['name'], header_row)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc
    _expire()
    if len(_uploads) >= MAX_CACHED_UPLOADS: raise HTTPException(429, '结果文件缓存已满，请稍后或分批处理')
    identity = str(uuid4()); _uploads[identity] = CachedUpload(book, monotonic())
    return {'upload_id': identity, 'filename': book.filename, 'file_sha256': book.file_sha256, 'sheets': sheets, 'suggested_mapping': suggestion}


@router.get('/{upload_id}/rows')
def result_rows(upload_id: str, sheet: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500), header_row: int = Query(1, ge=1)):
    try: return table_page(_book(upload_id), sheet, offset, limit, header_row)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc


@router.post('/normalize')
def normalize_upload(payload: NormalizePayload):
    try: return normalize_result(_book(payload.upload_id), payload.mapping)
    except ValueError as exc: raise HTTPException(422, str(exc)) from exc


@router.post('/from-fit')
def from_fit(payload: InternalResultPayload):
    try: return adapt_internal_result(payload.engine, payload.result, payload.source, payload.mode, payload.metadata)
    except (ValueError, TypeError, KeyError) as exc: raise HTTPException(422, str(exc)) from exc
