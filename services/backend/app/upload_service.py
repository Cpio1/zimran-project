"""Storage and PostgreSQL are coordinated through a durable upload intent."""

from app.storage import StorageError


def upload_document(repository, storage, entry_id, file, key):
    # Configuration and bucket privacy must be verified before accepting a file.
    storage.ensure_private()
    intent = repository.reserve_upload(entry_id, file, storage.settings.bucket, key)
    if "cached" in intent:
        return intent["cached"]
    try:
        storage.upload(intent["path"], file.content, file.mime_type)
    except StorageError:
        # A timeout may mean Storage accepted the file. Keep its path durably tracked.
        # If this update fails too, the original reserved row still tracks the path.
        repository.mark_cleanup(intent["key_hash"])
        raise
    # Do not delete on commit failure: commit may have succeeded despite a lost reply.
    # Replaying the same key recovers a completed response; otherwise operator cleanup
    # handles the reserved path. Documents+job+completed response commit together.
    return repository.complete_upload(intent["key_hash"])
