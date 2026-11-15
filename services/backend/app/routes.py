"""Public shared-workspace upload routes. No visitor session authentication."""

from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, Request
from starlette.concurrency import run_in_threadpool
from starlette.datastructures import UploadFile
from starlette.exceptions import HTTPException

from app.config import get_storage_settings
from app.errors import ApiError
from app.file_validation import MAX_FILE_BYTES, validate_file
from app.repository import Repository
from app.storage import StorageClient
from app.upload_models import EntryCreate, EntryEnvelope, UploadEnvelope, DocumentEnvelope, JobEnvelope
from app.upload_service import upload_document

router = APIRouter(prefix="/api/v1")
Key = Annotated[str, Header(alias="Idempotency-Key", min_length=8, max_length=128)]


def get_repository():
    return Repository()


def get_storage():
    return StorageClient(get_storage_settings())


def client_ip(request):
    # Do not trust arbitrary X-Forwarded-For headers. Configure a trusted proxy at deployment.
    return request.client.host if request.client else "unknown"


def envelope(data):
    return {"data": data, "request_id": str(uuid4())}


@router.post("/entries", status_code=201, response_model=EntryEnvelope, operation_id="create_entry")
def create_entry(body: EntryCreate, request: Request, idempotency_key: Key,
                 repository: Annotated[Repository, Depends(get_repository)]):
    repository.admit(client_ip(request))
    return envelope(repository.create_entry(body.model_dump(), idempotency_key))


@router.post("/documents", status_code=202, response_model=UploadEnvelope, operation_id="upload_document",
    openapi_extra={"requestBody": {"required": True, "content": {"multipart/form-data": {"schema": {
        "type": "object", "required": ["entry_id", "file"], "additionalProperties": False,
        "properties": {"entry_id": {"type": "string", "format": "uuid"},
                       "file": {"type": "string", "format": "binary"}}}}}}})
async def create_document(request: Request, idempotency_key: Key,
                          repository: Annotated[Repository, Depends(get_repository)],
                          storage: Annotated[StorageClient, Depends(get_storage)]):
    await run_in_threadpool(repository.admit, client_ip(request))
    try:
        async with request.form(max_files=1, max_fields=1, max_part_size=MAX_FILE_BYTES) as form:
            if len(form.multi_items()) != 2 or set(form) != {"entry_id", "file"} or not isinstance(form["file"], UploadFile):
                raise ApiError(422, "VALIDATION_ERROR", "Provide exactly one entry_id and one file.")
            try:
                entry_id = UUID(str(form["entry_id"]))
            except ValueError:
                raise ApiError(422, "VALIDATION_ERROR", "entry_id must be a UUID.") from None
            incoming = form["file"]
            content = await incoming.read(MAX_FILE_BYTES + 1)
            file = await run_in_threadpool(validate_file, incoming.filename or "", incoming.content_type or "", content)
    except HTTPException:
        raise ApiError(422, "VALIDATION_ERROR", "Invalid multipart upload (one file and entry_id required).") from None
    return envelope(await run_in_threadpool(upload_document, repository, storage, entry_id, file, idempotency_key))


@router.get("/documents/{document_id}", response_model=DocumentEnvelope, operation_id="get_document")
def get_document(document_id: UUID, request: Request,
                 repository: Annotated[Repository, Depends(get_repository)]):
    repository.admit(client_ip(request), write=False)
    return envelope(repository.get_document(document_id))


@router.get("/jobs/{job_id}", response_model=JobEnvelope, operation_id="get_job")
def get_job(job_id: UUID, request: Request,
            repository: Annotated[Repository, Depends(get_repository)]):
    repository.admit(client_ip(request), write=False)
    return envelope(repository.get_job(job_id))
