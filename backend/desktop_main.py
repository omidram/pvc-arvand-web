"""PyInstaller windowed entry point.

When the EXE is built with ``console=False``, Windows sets ``sys.stdout`` and
``sys.stderr`` to ``None``. Uvicorn's default log formatter then crashes on
``sys.stdout.isatty()``. Attach a log file before importing the app.
"""
import os
import sys
from pathlib import Path


def _attach_stdio() -> None:
    if sys.stdout is not None and sys.stderr is not None:
        return
    base = Path(os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local"))
    log_dir = base / "PVCArvand"
    log_dir.mkdir(parents=True, exist_ok=True)
    stream = open(log_dir / "pvc_arvand.log", "a", encoding="utf-8", buffering=1)
    if sys.stdout is None:
        sys.stdout = stream
    if sys.stderr is None:
        sys.stderr = stream


_attach_stdio()

from app.desktop import main

if __name__ == "__main__":
    main()
