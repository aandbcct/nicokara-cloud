from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


def timeline_source_revision(job: dict, content: bytes) -> str:
    return f"{job.get('review_generation', 0)}:{hashlib.sha256(content).hexdigest()}"


def read_matching_draft(path: Path, revision: str) -> dict[str, Any] | None:
    if not path.is_file():
        return None
    draft = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(draft, dict):
        raise ValueError("invalid timeline draft")
    # Unversioned legacy files remain on disk, but cannot safely be auto-applied.
    if draft.get("source_revision") != revision:
        return None
    if not isinstance(draft.get("review"), dict) or not isinstance(draft.get("saved_at"), str):
        raise ValueError("invalid timeline draft")
    return draft
