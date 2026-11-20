"""Keep group numbers and coating names current without blocking a page save.

A save returns at once. This thread then walks Assembly Data in short batches and
writes the group each element matches. The on-screen counts do not wait for that
walk: they read the definitions directly.
"""
from __future__ import annotations

import logging
import threading

from . import models
from .coating_names import normalize_stored
from .database import SessionLocal
from .relations_sync import sync_element_group

logger = logging.getLogger("pvc_arvand.sync")

_wake = threading.Event()
_lock = threading.Lock()
_started = False
_cursor = 0
_BATCH = 400
_PAUSE_SECONDS = 8
_BURST = 8  # batches to run right after a definition change


def request_sync() -> None:
    """Ask the background thread to start again from the first element."""
    global _cursor
    _cursor = 0
    _wake.set()


def _batch(db) -> tuple[int, bool]:
    """Realign one slice of Assembly Data. The bool is True when the walk wrapped."""
    global _cursor
    definitions = db.query(models.GroupDefinition).all()
    rows = (
        db.query(models.Element)
        .filter(models.Element.id > _cursor)
        .order_by(models.Element.id)
        .limit(_BATCH)
        .all()
    )
    if not rows:
        _cursor = 0
        return 0, True
    wrapped = len(rows) < _BATCH
    _cursor = 0 if wrapped else rows[-1].id
    changed = 0
    for el in rows:
        if sync_element_group(db, el, definitions) in ("assigned", "cleared"):
            changed += 1
    return changed, wrapped


def _run(normalize: bool) -> None:
    db = SessionLocal()
    dirty = False
    try:
        if normalize:
            if normalize_stored(db):
                dirty = True
                db.commit()
            else:
                db.rollback()
        rounds = _BURST if normalize else 1
        for _ in range(rounds):
            changed, wrapped = _batch(db)
            if changed:
                dirty = True
                db.commit()
            else:
                db.rollback()
            if wrapped:
                break
        if dirty:
            from .element_dashboard import clear_cache

            clear_cache()
    except Exception:
        db.rollback()
        logger.exception("background link sync failed")
    finally:
        db.close()


def _loop() -> None:
    while True:
        woken = _wake.wait(_PAUSE_SECONDS)
        _wake.clear()
        if not _lock.acquire(blocking=False):
            continue
        try:
            _run(normalize=woken)
        finally:
            _lock.release()


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_loop, name="link-sync", daemon=True).start()
    request_sync()
