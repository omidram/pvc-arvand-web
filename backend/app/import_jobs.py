"""Background import jobs so the browser can show how much of the file is in."""
from __future__ import annotations

import threading
import uuid
from typing import Any, Callable

from fastapi import HTTPException

from .database import SessionLocal

Progress = Callable[[int, int], None]

_lock = threading.Lock()
_jobs: dict[str, dict[str, Any]] = {}


def _remember(job_id: str, **fields: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job.update(fields)


def create_job() -> str:
    job_id = uuid.uuid4().hex
    with _lock:
        if len(_jobs) > 40:
            for old in list(_jobs)[:-20]:
                _jobs.pop(old, None)
        _jobs[job_id] = {
            "processed": 0,
            "total": 0,
            "percent": 0,
            "done": False,
            "error": None,
            "result": None,
        }
    return job_id


def report(job_id: str, processed: int, total: int) -> None:
    percent = 100 if total and processed >= total else (int(processed * 100 / total) if total else 0)
    _remember(job_id, processed=processed, total=total, percent=percent)


def finish(job_id: str, result: dict) -> None:
    _remember(job_id, done=True, percent=100, result=result)


def fail(job_id: str, message: str) -> None:
    _remember(job_id, done=True, error=message)


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def tick(progress: Progress | None, processed: int, total: int) -> None:
    if progress and (processed == total or processed == 1 or processed % 25 == 0):
        progress(processed, total)


def spawn_import(work: Callable[..., dict]) -> dict[str, str]:
    """Run work(db, progress) on a new session and return a job id immediately."""
    job_id = create_job()

    def run() -> None:
        db = SessionLocal()
        try:
            result = work(db, lambda processed, total: report(job_id, processed, total))
            finish(job_id, result if isinstance(result, dict) else {"ok": True})
        except HTTPException as exc:
            db.rollback()
            detail = exc.detail
            fail(job_id, detail if isinstance(detail, str) else str(detail))
        except Exception as exc:  # noqa: BLE001
            db.rollback()
            fail(job_id, str(exc))
        finally:
            db.close()

    threading.Thread(target=run, daemon=True).start()
    return {"job_id": job_id}
