"""独立解析计算接口，不持久化、不触发原谱拟合。"""
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from .errors import CalculationError
from .runner import evaluate_request, validate_request
from .templates import template_catalog

router = APIRouter(prefix='/api/peak-calculations', tags=['峰参数二次计算'])


class EvaluationRequest(BaseModel):
    model_config = ConfigDict(extra='forbid', allow_inf_nan=False)
    records: list[dict[str, Any]] = Field(default_factory=list, max_length=10000)
    method: Literal['formula', 'lattice', 'scherrer', 'strain', 'williamson_hall', 'calibration']
    config: dict[str, Any] = Field(default_factory=dict)


@router.get('/templates')
def catalog():
    return template_catalog()


@router.post('/validate')
def validate(payload: EvaluationRequest):
    return validate_request(payload)


@router.post('/evaluate')
def evaluate(payload: EvaluationRequest):
    try:
        return evaluate_request(payload)
    except CalculationError as exc:
        raise HTTPException(status_code=422, detail=exc.as_dict()) from exc
