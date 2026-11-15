"""Bounded format validation only: no OCR, rendering, or AI calls."""

import hashlib
import io
import re
import warnings
from dataclasses import dataclass

from PIL import Image
from pypdf import PdfReader

from app.errors import ApiError

MAX_FILE_BYTES = 10 * 1024 * 1024
MAX_PAGES = 25
MAX_PIXELS = 20_000_000
EXTENSIONS = {"application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png"}


@dataclass(frozen=True)
class ValidatedFile:
    name: str
    mime_type: str
    extension: str
    sha256: str
    page_count: int
    content: bytes


def validate_file(name: str, mime_type: str, content: bytes) -> ValidatedFile:
    if len(content) > MAX_FILE_BYTES:
        raise ApiError(413, "FILE_TOO_LARGE", "Maximum file size is 10 MB.")
    if not content:
        raise ApiError(422, "VALIDATION_ERROR", "Empty files are not supported.")
    if mime_type not in EXTENSIONS:
        raise ApiError(422, "VALIDATION_ERROR", "Only PDF, JPEG, and PNG are supported.")
    signatures = {"application/pdf": b"%PDF-", "image/jpeg": b"\xff\xd8\xff", "image/png": b"\x89PNG\r\n\x1a\n"}
    if not content.startswith(signatures[mime_type]):
        raise ApiError(422, "VALIDATION_ERROR", "File signature does not match its MIME type.")
    try:
        if mime_type == "application/pdf":
            reader = PdfReader(io.BytesIO(content), strict=True)
            if reader.is_encrypted:
                raise ValueError("Encrypted PDF")
            pages = len(reader.pages)
            if not 1 <= pages <= MAX_PAGES:
                raise ValueError("Page limit")
        else:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(io.BytesIO(content)) as image:
                    expected = "JPEG" if mime_type == "image/jpeg" else "PNG"
                    if image.format != expected or image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                        raise ValueError("Image limits")
                    image.verify()
            pages = 1
    except Exception:
        # Parsers may include untrusted file contents in their errors. Never relay them.
        raise ApiError(422, "UNREADABLE_DOCUMENT",
                       "Invalid file, encrypted PDF, or document exceeds 25 pages / 20 million pixels.") from None
    # The original filename is display metadata only; never use it as a storage path.
    safe_name = re.sub(r"[\x00-\x1f\x7f]", "", name.replace("\\", "/").rsplit("/", 1)[-1])[:200]
    return ValidatedFile(safe_name or f"document.{EXTENSIONS[mime_type]}", mime_type,
                         EXTENSIONS[mime_type], hashlib.sha256(content).hexdigest(), pages, content)
