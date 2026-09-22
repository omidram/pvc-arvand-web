"""File-level helpers for the automatic/manual SQLite backup system."""
import re
import sqlite3
from datetime import datetime
from pathlib import Path

from .config import settings
from .paths import data_root

BACKUP_DIR = data_root() / "backups"
FILENAME_RE = re.compile(r"^pvc_arvand_backup_\d{8}_\d{6}\.db$")


def _db_path() -> Path:
    url = settings.DATABASE_URL
    prefix = "sqlite:///"
    if not url.startswith(prefix):
        raise RuntimeError("Automatic backup only supports the default SQLite database.")
    return Path(url[len(prefix):]).resolve()


def create_backup(retention_count: int | None = None) -> dict:
    """Creates a consistent snapshot of the live SQLite database using the
    native backup API (safe to run while the app is serving requests), then
    prunes old backups beyond retention_count (if given)."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    src_path = _db_path()
    if not src_path.exists():
        raise FileNotFoundError(f"Database file not found at {src_path}")

    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    dest_path = BACKUP_DIR / f"pvc_arvand_backup_{stamp}.db"

    src_conn = sqlite3.connect(str(src_path))
    dest_conn = sqlite3.connect(str(dest_path))
    try:
        src_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        src_conn.close()

    if retention_count:
        _apply_retention(retention_count)

    stat = dest_path.stat()
    return {"filename": dest_path.name, "size_bytes": stat.st_size, "created_at": datetime.utcfromtimestamp(stat.st_mtime)}


def _apply_retention(retention_count: int) -> None:
    files = sorted(BACKUP_DIR.glob("pvc_arvand_backup_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    for old_file in files[retention_count:]:
        old_file.unlink(missing_ok=True)


def list_backups() -> list[dict]:
    if not BACKUP_DIR.exists():
        return []
    files = sorted(BACKUP_DIR.glob("pvc_arvand_backup_*.db"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [
        {
            "filename": f.name,
            "size_bytes": f.stat().st_size,
            "created_at": datetime.utcfromtimestamp(f.stat().st_mtime),
        }
        for f in files
    ]


def resolve_backup_path(filename: str) -> Path:
    """Validates the filename against the expected pattern to prevent path traversal."""
    if not FILENAME_RE.match(filename):
        raise ValueError("Invalid backup filename.")
    path = (BACKUP_DIR / filename).resolve()
    if BACKUP_DIR.resolve() not in path.parents:
        raise ValueError("Invalid backup filename.")
    return path


def delete_backup(filename: str) -> None:
    path = resolve_backup_path(filename)
    if not path.exists():
        raise FileNotFoundError(filename)
    path.unlink()
