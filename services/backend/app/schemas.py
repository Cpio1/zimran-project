"""Response models for the initial Claimly health endpoint."""

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field

CONTRACT_VERSION = "2.0.0"


class Health(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["ok", "degraded"] = "ok"
    service: Literal["backend", "llm"] = "backend"
    contract_version: Literal["2.0.0"] = CONTRACT_VERSION


class HealthEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data: Health = Field(default_factory=Health)
    request_id: str = Field(default_factory=lambda: str(uuid4()))
