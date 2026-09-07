from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
from contextlib import contextmanager
from contextvars import ContextVar
from pathlib import Path

from app.core.config import Settings
from starlette.datastructures import Headers
from starlette.responses import JSONResponse


class ResourceCapacityError(RuntimeError):
    """Temporary admission failure; callers may retry without losing input."""


class UploadStorageMiddleware:
    def __init__(self, app, *, settings: Settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] == "POST":
            headers = Headers(scope=scope)
            if headers.get("content-type", "").startswith("multipart/form-data"):
                try:
                    size = max(0, int(headers.get("content-length", "0")))
                except ValueError:
                    size = 0
                try:
                    ResourcePolicy(self.settings).check_storage(size)
                    check_disk_space(Path(tempfile.gettempdir()), size,
                                     min_free_bytes=self.settings.min_free_disk_bytes)
                except ResourceCapacityError as exc:
                    await JSONResponse(status_code=503, content={"detail": str(exc)},
                                       headers={"Retry-After": "60"})(scope, receive, send)
                    return
        await self.app(scope, receive, send)


_disk_floor: ContextVar[int] = ContextVar("storage_disk_floor", default=0)


@contextmanager
def storage_write_context(min_free_bytes: int):
    token = _disk_floor.set(min_free_bytes)
    try:
        yield
    finally:
        _disk_floor.reset(token)


def check_disk_space(path: Path, additional_bytes: int = 0, *,
                     min_free_bytes: int | None = None) -> None:
    existing = path.resolve()
    while not existing.exists():
        existing = existing.parent
    floor = _disk_floor.get() if min_free_bytes is None else min_free_bytes
    if shutil.disk_usage(existing).free < floor + additional_bytes:
        raise ResourceCapacityError("服务器剩余存储空间不足，请稍后重试。")


class ResourcePolicy:
    def __init__(self, settings: Settings):
        self.settings = settings

    def check_storage(self, additional_bytes: int = 0) -> None:
        check_disk_space(self.settings.storage_dir, additional_bytes,
                         min_free_bytes=self.settings.min_free_disk_bytes)
        check_disk_space(self.settings.data_dir,
                         min_free_bytes=self.settings.min_free_disk_bytes)

    def check_job_capacity(self, connection: sqlite3.Connection) -> None:
        count = connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE status IN ('UPLOADED', 'PROCESSING')",
        ).fetchone()[0]
        if count >= self.settings.max_active_jobs:
            raise ResourceCapacityError("服务器待处理任务已满，请稍后重试。")
        self.check_storage()

    def check_upload_capacity(self, connection: sqlite3.Connection, *,
                              size_bytes: int, client_key: str) -> None:
        tickets = connection.execute(
            "SELECT client_key, video_size_bytes FROM upload_tickets "
            "WHERE status IN ('WAITING', 'READY', 'UPLOADING')",
        ).fetchall()
        sessions = [dict(ticket) for ticket in tickets]
        # Audio sessions predate database tickets. Count them under the same
        # SQLite admission lock so concurrent video/audio requests share a cap.
        for path in (self.settings.storage_dir / "_uploads").glob("*/metadata.json"):
            try:
                metadata = json.loads(path.read_text(encoding="utf-8"))
                if metadata.get("upload_kind") == "audio":
                    metadata["video_size_bytes"] = max(0, int(metadata["video_size_bytes"]))
                    sessions.append(metadata)
            except (OSError, ValueError, AttributeError, TypeError, KeyError):
                sessions.append({"video_size_bytes": self.settings.max_audio_bytes})
        if len(sessions) >= self.settings.max_upload_sessions:
            raise ResourceCapacityError("服务器上传会话已满，请稍后重试。")
        client_jobs = connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE client_key = ? "
            "AND status IN ('UPLOADED', 'PROCESSING')", (client_key,),
        ).fetchone()[0]
        client_sessions = sum(session.get("client_key") == client_key for session in sessions)
        if client_jobs + client_sessions >= self.settings.max_active_jobs_per_client:
            raise ResourceCapacityError("当前客户端的上传或处理任务已满，请稍后重试。")
        self.check_job_capacity(connection)
        # Keep room for both uploaded parts and their merged input.
        reserved = sum(int(session["video_size_bytes"]) * 2 for session in sessions)
        self.check_storage(reserved + size_bytes * 2)
