"""XPS 专用版本化配置；保持原单峰接口独立。"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Parameter(StrictModel):
    value: FiniteFloat
    lower: FiniteFloat | None = None
    upper: FiniteFloat | None = None
    fixed: bool = False


class Component(StrictModel):
    id: str = Field(pattern=r"^[a-zA-Z][a-zA-Z0-9_-]{0,63}$")
    label: str = ""
    enabled: bool = True
    model: Literal["gaussian", "lorentz", "psd_voigt1", "split_psd_voigt", "emg_high", "emg_low"] = "psd_voigt1"
    parameters: dict[str, Parameter]


class Reference(StrictModel):
    component: str
    parameter: Literal["A", "xc", "w", "mu", "h_low", "h_high", "sigma", "tau"]


class Constraint(StrictModel):
    target: Reference
    source: Reference
    kind: Literal["offset", "ratio"]
    value: FiniteFloat


class Group(StrictModel):
    id: str
    label: str = ""
    component_ids: list[str]


class Background(StrictModel):
    kind: Literal["none", "line", "shirley"] = "line"
    low_window: tuple[FiniteFloat, FiniteFloat] | None = None
    high_window: tuple[FiniteFloat, FiniteFloat] | None = None
    low_level: FiniteFloat | None = None
    high_level: FiniteFloat | None = None
    tolerance: FiniteFloat = Field(default=1e-7, gt=0, le=0.01)
    max_iterations: int = Field(default=500, ge=1, le=10000)
    confirmed: bool = False


class SolverSettings(StrictModel):
    max_nfev: int = Field(default=3000, ge=1, le=20000)
    tolerance: FiniteFloat = Field(default=1e-9, ge=1e-14, le=1e-3)


class Source(StrictModel):
    filename: str
    file_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    sheet: str
    x_column: str
    y_column: str


class XpsRequest(StrictModel):
    schema_version: Literal[1, 2] = 1
    x: list[FiniteFloat] = Field(min_length=3, max_length=100000)
    y: list[FiniteFloat] = Field(min_length=3, max_length=100000)
    range_start: FiniteFloat | None = None
    range_end: FiniteFloat | None = None
    shift_eV: FiniteFloat = 0
    calibration_note: str = ""
    background: Background = Field(default_factory=Background)
    components: list[Component] = Field(default_factory=list, max_length=40)
    constraints: list[Constraint] = Field(default_factory=list, max_length=160)
    groups: list[Group] = Field(default_factory=list)
    solver: SolverSettings = Field(default_factory=SolverSettings)
    source: Source | None = None

    @model_validator(mode="after")
    def check_data(self):
        if self.schema_version == 1 and self.required_version() == 2:
            raise ValueError("非对称模型或新增参数需要配置版本 2")
        if len(self.x) != len(self.y):
            raise ValueError("x/y 长度必须一致")
        if self.range_start is not None and self.range_end is not None and self.range_start >= self.range_end:
            raise ValueError("区间下限必须小于上限")
        ids = [c.id for c in self.components]
        if len(ids) != len(set(ids)):
            raise ValueError("峰 ID 不能重复")
        group_ids = [g.id for g in self.groups]
        if len(group_ids) != len(set(group_ids)):
            raise ValueError("峰组 ID 不能重复")
        members = [c for g in self.groups for c in g.component_ids]
        if len(members) != len(set(members)) or any(c not in ids for c in members):
            raise ValueError("峰组成员必须存在且不能重复归组")
        return self

    def required_version(self):
        legacy_models = {"gaussian", "lorentz", "psd_voigt1"}
        legacy_params = {"A", "xc", "w", "mu"}
        if any(c.model not in legacy_models or set(c.parameters)-legacy_params for c in self.components):
            return 2
        if any(r.parameter not in legacy_params for c in self.constraints for r in (c.source,c.target)):
            return 2
        return 1
