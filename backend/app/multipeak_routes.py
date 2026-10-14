"""独立的通用多峰 HTTP 入口。"""
from fastapi import APIRouter
from .multipeak_schemas import MultiPeakRequest
from .multipeak_fitting import fit_multipeak, preview_multipeak, suggest_multipeak, validate_multipeak
from .xps_routes import checked

router = APIRouter(prefix='/api/multipeak', tags=['通用多峰'])


@router.post('/validate')
def validate(request: MultiPeakRequest):
    return checked(validate_multipeak, request)


@router.post('/preview')
def preview(request: MultiPeakRequest):
    return checked(preview_multipeak, request)


@router.post('/candidates')
def candidates(request: MultiPeakRequest):
    return checked(suggest_multipeak, request)


@router.post('/fit')
def fit(request: MultiPeakRequest):
    return checked(fit_multipeak, request)
