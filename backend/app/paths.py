"""Resource (read-only, bundled) vs data (writable) directories.

Desktop EXE: static files live inside the PyInstaller bundle; the SQLite
database, JWT secret, and backups live under %LOCALAPPDATA%\\PVCArvand so
they survive upgrades.

Docker: PVC_STATIC_DIR / PVC_DATA_DIR are set in the image / compose file.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def is_production() -> bool:
    return is_frozen() or os.environ.get("PVC_ENV", "").lower() == "production"


def backend_dir() -> Path:
    """Directory that contains the `app` package in a source checkout."""
    return Path(__file__).resolve().parent.parent


def resource_root() -> Path:
    """Read-only files shipped with the application (frontend, seed DB)."""
    env = os.environ.get("PVC_RESOURCE_DIR")
    if env:
        return Path(env)
    if is_frozen():
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return backend_dir()


def data_root() -> Path:
    """Writable application data (database, backups, generated secrets)."""
    env = os.environ.get("PVC_DATA_DIR")
    if env:
        path = Path(env)
        path.mkdir(parents=True, exist_ok=True)
        return path
    if is_frozen():
        local = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        path = Path(local) / "PVCArvand"
        path.mkdir(parents=True, exist_ok=True)
        return path
    path = backend_dir() / "instance"
    path.mkdir(parents=True, exist_ok=True)
    return path


def static_dir() -> Path:
    env = os.environ.get("PVC_STATIC_DIR")
    if env:
        return Path(env)
    bundled = resource_root() / "static"
    if bundled.exists():
        return bundled
    # Source checkout after a static export: backend/static
    return backend_dir() / "static"


def seed_db_path() -> Path | None:
    for candidate in (
        resource_root() / "seed" / "pvc_arvand.db",
        backend_dir() / "instance" / "pvc_arvand.db",
    ):
        if candidate.is_file():
            return candidate
    return None
