"""DTOs retain the existing contract's public field names."""

from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

Category = Literal['receipt', 'warranty', 'insurance', 'service_agreement', 'service_contract',
                   'gift_certificate', 'subscription', 'membership', 'refund_confirmation',
                   'correspondence', 'other']


class EntryCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=200)
    category: Category
    provider: str | None = Field(default=None, max_length=200)
    subject: str | None = Field(default=None, max_length=500)


class EntryData(BaseModel):
    id: UUID
    title: str
    category: Category
    provider: str | None
    subject: str | None
    facts: dict
    data_version: int
    document_ids: list[UUID] = Field(default_factory=list)
    benefit_ids: list[UUID] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class DocumentData(BaseModel):
    id: UUID
    entry_id: UUID
    name: str
    mime_type: Literal['application/pdf', 'image/jpeg', 'image/png']
    version: int
    status: Literal['uploaded', 'processing', 'needs_review', 'ready', 'failed']
    page_count: int | None
    facts: dict
    review_flags: list[str]
    created_at: datetime


class JobData(BaseModel):
    id: UUID
    kind: Literal['extract']
    status: Literal['queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale']
    progress: int | None
    result: dict | None
    error: dict | None
    created_at: datetime
    updated_at: datetime


class UploadAccepted(BaseModel):
    document: DocumentData
    job: JobData


class EntryEnvelope(BaseModel):
    data: EntryData
    request_id: str


class DocumentEnvelope(BaseModel):
    data: DocumentData
    request_id: str


class JobEnvelope(BaseModel):
    data: JobData
    request_id: str


class UploadEnvelope(BaseModel):
    data: UploadAccepted
    request_id: str
