from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from app.core.config import Settings
from app.main import create_app


def settings_for(tmp_path, **overrides):
    return Settings(_env_file=None, data_dir=tmp_path / "data",
                    storage_dir=tmp_path / "jobs", processing_enabled=False,
                    cleanup_enabled=False, **overrides)


def audio_payload():
    return dict(client_submission_id=str(uuid4()), audio_name="song.wav",
                audio_size_bytes=20, chunk_size_bytes=8 * 1024 * 1024,
                total_chunks=1, original_video_name="song.mp4",
                original_video_size_bytes=100)


def create_job(database, root: Path, **extra):
    return database.create_job(
        job_id=str(uuid4()), original_video_name="song.mp4", video_size_bytes=20,
        video_sha256="a" * 64, video_path=root / "input.mp4",
        lyrics_source=None, lyrics_path=None, **extra,
    )


def test_concurrent_video_admission_cannot_exceed_session_limit(tmp_path):
    app = create_app(settings_for(tmp_path, max_upload_sessions=1))
    with TestClient(app) as client:
        def submit(_):
            return client.post("/api/v1/upload-tickets", json={
                "video_name": "song.mp4", "video_size_bytes": 20,
            }).status_code
        with ThreadPoolExecutor(max_workers=4) as pool:
            statuses = list(pool.map(submit, range(4)))
        assert statuses.count(201) == 1
        assert statuses.count(503) == 3


def test_audio_sessions_share_video_limit_and_resume_at_capacity(tmp_path):
    app = create_app(settings_for(tmp_path, max_upload_sessions=1))
    payload = audio_payload()
    with TestClient(app) as client:
        assert client.post("/api/v1/browser/audio-uploads", json=payload).status_code == 201
        assert client.post("/api/v1/browser/audio-uploads", json=payload).status_code == 200
        assert client.post("/api/v1/browser/audio-uploads", json=audio_payload()).status_code == 503
        rejected = client.post("/api/v1/upload-tickets", json={
            "video_name": "song.mp4", "video_size_bytes": 20,
        })
        assert rejected.status_code == 503
        assert rejected.headers["retry-after"] == "60"


def test_global_job_limit_covers_create_retry_and_admin_requeue(tmp_path):
    from app.core.resource_limits import ResourceCapacityError

    app = create_app(settings_for(tmp_path, max_active_jobs=1))
    with TestClient(app):
        database = app.state.database
        first = create_job(database, tmp_path)
        database.update_job_state(first["id"], status="FAILED", stage="TRANSCRIBING", progress=40)
        second = create_job(database, tmp_path)
        for operation in (lambda: create_job(database, tmp_path),
                          lambda: database.retry_failed_job(first["id"]),
                          lambda: database.requeue_job(first["id"])):
            with pytest.raises(ResourceCapacityError):
                operation()
        assert database.get_job(first["id"])["status"] == "FAILED"
        database.cancel_job(second["id"])
        assert database.retry_failed_job(first["id"])["status"] == "UPLOADED"


def test_low_disk_rejects_upload_before_creating_session(tmp_path, monkeypatch):
    from collections import namedtuple
    import app.core.resource_limits as resources

    usage = namedtuple("usage", "total used free")
    app = create_app(settings_for(tmp_path, min_free_disk_bytes=100))
    with TestClient(app) as client:
        monkeypatch.setattr(resources.shutil, "disk_usage", lambda path: usage(1000, 920, 80))
        response = client.post("/api/v1/upload-tickets", json={
            "video_name": "song.mp4", "video_size_bytes": 20,
        })
        assert response.status_code == 503
        assert app.state.database.list_active_upload_tickets() == []


def test_failed_chunk_disk_check_preserves_previously_received_part(tmp_path, monkeypatch):
    from collections import namedtuple
    import app.core.resource_limits as resources

    usage = namedtuple("usage", "total used free")
    app = create_app(settings_for(tmp_path, min_free_disk_bytes=100))
    with TestClient(app) as client:
        payload = audio_payload()
        client.post("/api/v1/browser/audio-uploads", json=payload)
        path = f"/api/v1/browser/audio-uploads/{payload['client_submission_id']}/chunks/part/0"
        assert client.post(path, files={"chunk": ("part", b"a" * 20)}).status_code == 200
        monkeypatch.setattr(resources.shutil, "disk_usage", lambda path: usage(1000, 895, 105))
        assert client.post(path, files={"chunk": ("part", b"b" * 20)}).status_code == 503
        part = next((tmp_path / "jobs" / "_uploads").rglob("*.part"))
        assert part.read_bytes() == b"a" * 20


def test_full_job_capacity_preserves_completed_video_parts_for_retry(tmp_path):
    app = create_app(settings_for(tmp_path, max_active_jobs=1))
    content = b"\x00\x00\x00\x18ftypisom" + b"video"
    with TestClient(app) as client:
        ticket = client.post("/api/v1/upload-tickets", json={
            "video_name": "song.mp4", "video_size_bytes": len(content),
        }).json()["id"]
        base = f"/api/v1/upload-tickets/{ticket}/chunks"
        assert client.post(base + "/start", json={
            "video_name": "song.mp4", "video_size_bytes": len(content),
            "chunk_size_bytes": len(content), "total_chunks": 1,
        }).status_code == 200
        assert client.post(base + "/part/0", files={"chunk": ("part", content)}).status_code == 200
        blocker = create_job(app.state.database, tmp_path)
        assert client.post(base + "/complete", data={"lyrics_text": "song"}).status_code == 503
        assert app.state.database.get_upload_ticket(ticket)["status"] == "UPLOADING"
        assert list((tmp_path / "jobs" / "_uploads" / ticket).rglob("*.part"))
        app.state.database.cancel_job(blocker["id"])
        assert client.post(base + "/complete", data={"lyrics_text": "song"}).status_code == 201


@pytest.mark.parametrize("admin", [False, True])
def test_retry_when_memory_queue_is_full_stays_in_persistent_queue(tmp_path, admin):
    from app.tasks.runner import QueueCapacityError

    class FullRunner:
        async def start(self):
            pass

        async def stop(self):
            pass

        async def enqueue(self, job_id):
            raise QueueCapacityError()

    app = create_app(settings_for(tmp_path, admin_token="test-token"), runner=FullRunner())
    with TestClient(app) as client:
        job = create_job(app.state.database, tmp_path, client_key="client")
        app.state.database.update_job_state(job["id"], status="FAILED", stage="TRANSCRIBING", progress=40)
        path = f"/api/v1/admin/jobs/{job['id']}/requeue" if admin else f"/api/v1/jobs/{job['id']}/retry"
        response = client.post(path, headers={"Authorization": "Bearer test-token"})
        assert response.status_code == 200
        assert app.state.database.get_job(job["id"])["status"] == "UPLOADED"


def test_concurrent_idempotent_ticket_creation_uses_one_slot(tmp_path):
    app = create_app(settings_for(tmp_path, max_upload_sessions=1))
    payload = {"video_name": "song.mp4", "video_size_bytes": 20, "client_submission_id": str(uuid4())}
    with TestClient(app) as client:
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: client.post("/api/v1/upload-tickets", json=payload), range(4)))
        assert all(response.status_code == 201 for response in responses)
        assert len({response.json()["id"] for response in responses}) == 1


@pytest.mark.parametrize("value", [0, -1, float("inf"), float("nan")])
def test_shutdown_deadline_must_be_positive_and_finite(tmp_path, value):
    with pytest.raises(ValueError):
        settings_for(tmp_path, shutdown_timeout_seconds=value)
