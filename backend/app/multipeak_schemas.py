"""通用多峰独立配置；不扩大 XPS 历史配置的可接受范围。"""
from typing import Literal
from pydantic import Field, FiniteFloat, model_validator
from .xps_schemas import StrictModel, Parameter, SolverSettings, Source

ModelName = Literal['gaussian', 'lorentz', 'psd_voigt1', 'psd_voigt2', 'split_psd_voigt', 'emg_high', 'emg_low']
ParameterName = Literal['A', 'xc', 'w', 'wG', 'wL', 'mu', 'h_low', 'h_high', 'sigma', 'tau']


class Component(StrictModel):
    id: str = Field(pattern=r'^[a-zA-Z][a-zA-Z0-9_-]{0,63}$')
    label: str = ''
    enabled: bool = True
    model: ModelName = 'psd_voigt1'
    parameters: dict[ParameterName, Parameter]


class Reference(StrictModel):
    component: str
    parameter: ParameterName


class Constraint(StrictModel):
    source: Reference
    target: Reference
    kind: Literal['offset', 'ratio']
    value: FiniteFloat


class Anchor(StrictModel):
    x: FiniteFloat
    y: FiniteFloat


class Baseline(StrictModel):
    kind: Literal['none', 'constant', 'line', 'polynomial', 'spline', 'bspline'] = 'line'
    anchors: list[Anchor] = Field(default_factory=list, max_length=1000)
    degree: int = Field(default=2, ge=1, le=8)
    smoothing: FiniteFloat = Field(default=0, ge=0)
    confirmed: bool = False


class MultiPeakRequest(StrictModel):
    schema_version: Literal[1] = 1
    analysis_mode: Literal['general', 'xrd'] = 'general'
    x: list[FiniteFloat] = Field(min_length=4, max_length=100000)
    y: list[FiniteFloat] = Field(min_length=4, max_length=100000)
    range_start: FiniteFloat | None = None
    range_end: FiniteFloat | None = None
    baseline: Baseline = Field(default_factory=Baseline)
    components: list[Component] = Field(default_factory=list, max_length=40)
    constraints: list[Constraint] = Field(default_factory=list, max_length=160)
    solver: SolverSettings = Field(default_factory=SolverSettings)
    source: Source | None = None

    @model_validator(mode='after')
    def check_data(self):
        if len(self.x) != len(self.y):
            raise ValueError('X/Y 长度必须一致')
        if self.range_start is not None and self.range_end is not None and self.range_start >= self.range_end:
            raise ValueError('区间下限必须小于上限')
        ids = [c.id for c in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError('峰 ID 不能重复')
        return self
