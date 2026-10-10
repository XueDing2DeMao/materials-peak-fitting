"""HTTP payload contracts kept separate from numerical-domain dataclasses."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class AnchorPayload(BaseModel):
    x: float
    y: float


class ParameterBoundsPayload(BaseModel):
    lower: float | None = None
    upper: float | None = None


class PreviewPayload(BaseModel):
    dataset_id: str
    sheet: str | None = None
    x_column: str
    y_column: str


class FitPayload(BaseModel):
    x: list[float] = Field(min_length=4)
    y: list[float] = Field(min_length=4)
    model: str
    baseline_kind: Literal["none", "constant", "line", "polynomial", "spline", "bspline"]
    anchors: list[AnchorPayload]
    degree: int = Field(default=2, ge=1, le=8)
    smoothing: float = Field(default=0.0, ge=0.0)
    range_start: float | None = None
    range_end: float | None = None
    initial_parameters: dict[str, float] = Field(default_factory=dict)
    parameter_bounds: dict[str, ParameterBoundsPayload] = Field(default_factory=dict)
    fixed_parameters: dict[str, float] = Field(default_factory=dict)
    anchor_source: Literal["manual", "suggested", "endpoint_default"] = "manual"
    baseline_confirmed: bool = True
    staged_fit: bool = True
    center_lock_evaluations: int = Field(default=20, ge=0, le=500)
    max_function_evaluations: int = Field(default=2000, ge=1, le=20000)
    tolerance: float = Field(default=1e-8, gt=0, lt=1)


class ModelComparisonPayload(FitPayload):
    """Uses the full fit configuration but never changes the active user selection."""
    include_asymmetric: bool = False


class ExportPayload(BaseModel):
    kind: Literal["curves", "parameters"]
    result: dict[str, Any]
