from __future__ import annotations

import logging
import os
import re
import shutil
import sqlite3
import subprocess
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import String, TypeDecorator, create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

_log = logging.getLogger("uvicorn.error")

_sqlite = settings.DATABASE_URL.startswith("sqlite")
# timeout is SQLite's busy wait, in seconds. Without it a short password update
# fails as soon as a report or import still holds the file.
connect_args = {"check_same_thread": False, "timeout": 30} if _sqlite else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)


@event.listens_for(engine, "connect")
def _sqlite_on_connect(dbapi_connection, connection_record) -> None:
    """Wait out a brief lock instead of failing the password update immediately.

    journal_mode=WAL is not set here. On the plant server that pragma re-reads
    the schema and aborts startup with "malformed database schema (K1)" even
    though the same file opens and serves requests in rollback mode.
    """
    if not _sqlite:
        return
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute("PRAGMA busy_timeout=30000")
    finally:
        cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Plant tables. A broken entry with one of these names is reported, not deleted.
_CORE_SCHEMA = {
    "users",
    "app_roles",
    "role_permissions",
    "form_permissions",
    "elements",
    "electrode_segregations",
    "electrolyzer_normalizations",
    "voltage_readings",
    "inspection_reports",
    "audit_logs",
}

_SCHEMA_ERROR = re.compile(r"malformed database schema \((.+)\)")


def _sqlite_file() -> Path | None:
    url = settings.DATABASE_URL
    if not url.startswith("sqlite"):
        return None
    rest = url.split(":///", 1)[-1].split("?", 1)[0]
    if not rest or rest == ":memory:":
        return None
    return Path(rest)


def _schema_object_name(exc: BaseException) -> str | None:
    match = _SCHEMA_ERROR.search(str(exc))
    if not match:
        return None
    name = match.group(1).strip()
    if not name or name == "sqlite_master" or name.startswith("sqlite_"):
        return None
    return name


def _sqlite_user_tables(path: Path) -> int | None:
    try:
        conn = sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True, timeout=8)
        try:
            row = conn.execute(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchone()
            return int(row[0]) if row else 0
        finally:
            conn.close()
    except sqlite3.Error:
        return None


def _sqlite_readable(path: Path) -> bool:
    n = _sqlite_user_tables(path)
    return n is not None and n > 0


def _drop_schema_object(path: Path, name: str) -> bool:
    """Remove one unreadable schema entry so the rest of the file can open.

    Do not SELECT sqlite_master first: that parse is what raises
    ``malformed database schema (K1)``. DELETE with writable_schema is enough.
    """
    if not re.fullmatch(r"[A-Za-z0-9_]+", name or ""):
        return False
    if _drop_schema_via_python(path, name):
        return True
    return _drop_schema_via_cli(path, name)


def _drop_schema_via_python(path: Path, name: str) -> bool:
    conn = sqlite3.connect(path, timeout=30)
    try:
        try:
            if hasattr(conn, "setconfig"):
                conn.setconfig(sqlite3.SQLITE_DBCONFIG_WRITABLE_SCHEMA, True)
        except Exception:
            pass
        conn.execute("PRAGMA writable_schema=ON")
        removed = conn.execute("DELETE FROM sqlite_master WHERE name=?", (name,))
        conn.execute("PRAGMA writable_schema=OFF")
        conn.commit()
        if removed.rowcount <= 0:
            return False
        note = path.with_name(path.name + ".schema-repair.log")
        with note.open("a", encoding="utf-8") as handle:
            handle.write(f"deleted {name} via python rowcount={removed.rowcount}\n")
        _log.warning("Removed unreadable schema object %s (%s rows) from %s", name, removed.rowcount, path)
        return True
    except sqlite3.DatabaseError as exc:
        _log.error("Schema drop of %s failed: %s", name, exc)
        return False
    finally:
        conn.close()


def _drop_schema_via_cli(path: Path, name: str) -> bool:
    sqlite_bin = shutil.which("sqlite3")
    if not sqlite_bin:
        _log.error("sqlite3 CLI is not on PATH. Install it (apt install sqlite3) to drop schema object %s", name)
        return False
    script = (
        "PRAGMA writable_schema=ON;\n"
        f"DELETE FROM sqlite_master WHERE name='{name}';\n"
        "PRAGMA writable_schema=OFF;\n"
    )
    try:
        result = subprocess.run(
            [sqlite_bin, str(path)],
            input=script,
            text=True,
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        _log.error("sqlite3 CLI drop of %s failed: %s", name, exc)
        return False
    if result.returncode != 0:
        _log.error("sqlite3 CLI drop of %s failed: %s", name, (result.stderr or result.stdout).strip())
        return False
    note = path.with_name(path.name + ".schema-repair.log")
    with note.open("a", encoding="utf-8") as handle:
        handle.write(f"deleted {name} via sqlite3 CLI\n")
    _log.warning("Removed unreadable schema object %s via sqlite3 CLI from %s", name, path)
    return True


def _recover_sqlite_file(path: Path) -> bool:
    """Rebuild a corrupt SQLite file with the sqlite3 CLI `.recover` command.

    The original file is copied beside the live DB first. The live file is
    replaced only when the recovered copy opens and still has plant tables.
    """
    sqlite_bin = shutil.which("sqlite3")
    if not sqlite_bin:
        _log.error("sqlite3 CLI is not on PATH. Install it (apt install sqlite3) to recover %s", path)
        return False
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    bak = path.with_name(f"{path.name}.malformed-{stamp}")
    recovered = path.with_name(f"{path.name}.recovered-{stamp}")
    sql_path = path.with_name(f"{path.name}.recover-{stamp}.sql")
    try:
        shutil.copy2(path, bak)
    except OSError as exc:
        _log.error("Could not copy corrupt database aside: %s", exc)
        return False
    _log.warning("SQLite file is malformed. Copy saved at %s — attempting .recover", bak)
    recovered.unlink(missing_ok=True)
    try:
        with sql_path.open("w", encoding="utf-8", errors="replace") as out:
            dump = subprocess.run(
                [sqlite_bin, str(path), ".recover"],
                stdout=out,
                stderr=subprocess.PIPE,
                timeout=900,
                check=False,
            )
        if dump.returncode != 0:
            err = (dump.stderr or b"").decode("utf-8", "replace")[-2000:]
            _log.error("sqlite3 .recover exited %s: %s", dump.returncode, err)
        if not sql_path.is_file() or sql_path.stat().st_size < 80:
            _log.error("sqlite3 .recover produced no SQL for %s", path)
            return False
        with sql_path.open("r", encoding="utf-8", errors="replace") as stdin:
            load = subprocess.run(
                [sqlite_bin, str(recovered)],
                stdin=stdin,
                stderr=subprocess.PIPE,
                timeout=900,
                check=False,
            )
        if load.returncode != 0:
            err = (load.stderr or b"").decode("utf-8", "replace")[-2000:]
            _log.error("Loading recovered SQL failed: %s", err)
            return False
        tables = _sqlite_user_tables(recovered)
        if not tables:
            _log.error("Recovered file has no tables; leaving the original file in place. Backup: %s", bak)
            return False
        orig_size = path.stat().st_size
        rec_size = recovered.stat().st_size
        if orig_size > 1_000_000 and rec_size < orig_size * 0.02:
            _log.error(
                "Recovered file is far smaller than the original (%s vs %s bytes); not replacing. Backup: %s",
                rec_size,
                orig_size,
                bak,
            )
            return False
        os.replace(recovered, path)
        _log.warning("Replaced malformed SQLite with recovered file (%s tables). Original copy: %s", tables, bak)
        return True
    except (OSError, subprocess.SubprocessError) as exc:
        _log.error("SQLite recover failed: %s", exc)
        return False
    finally:
        sql_path.unlink(missing_ok=True)
        recovered.unlink(missing_ok=True)


def repair_malformed_schema() -> None:
    """Drop a schema entry SQLite cannot parse, such as the server object named K1.

    Core plant tables are left untouched. A readable database is not modified.
    A fully corrupt disk image is recovered with sqlite3 .recover when possible.
    """
    path = _sqlite_file()
    if path is None or not path.is_file():
        return
    last_exc: sqlite3.DatabaseError | None = None
    for _ in range(8):
        conn = sqlite3.connect(path, timeout=30)
        try:
            conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
            return
        except sqlite3.DatabaseError as exc:
            last_exc = exc
            broken = _schema_object_name(exc)
            disk_dead = "disk image is malformed" in str(exc).lower()
        finally:
            conn.close()
        if disk_dead or broken is None:
            break
        if broken in _CORE_SCHEMA:
            _log.error("SQLite schema is unreadable and was not modified: %s", broken)
            break
        if not _drop_schema_object(path, broken):
            break
    else:
        return
    if _sqlite_readable(path):
        return
    if _recover_sqlite_file(path) and _sqlite_readable(path):
        return
    backups = path.parent / "backups"
    detail = str(last_exc) if last_exc else "unreadable sqlite_master"
    raise RuntimeError(
        f"SQLite file is unreadable ({path}): {detail}. "
        f"The live file was not replaced with an empty database. "
        f"Copy the newest pvc_arvand_backup_*.db from {backups} over {path} and restart. "
        f"If sqlite3 is missing, install it (apt install sqlite3) and restart so automatic .recover can run."
    )


repair_malformed_schema()


class Base(DeclarativeBase):
    pass


def parse_loose_date(value) -> date | None:
    """Parse Access/SQLite date junk without raising (invalid → None)."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()
    if not text or text.lower() in {"none", "null", "nat", "-", "—"}:
        return None
    normalized = text.replace("/", "-").replace(".", "-")
    for candidate in (text[:10], normalized[:10]):
        try:
            return date.fromisoformat(candidate)
        except ValueError:
            pass
    parts = normalized.split("-")
    if len(parts) >= 3:
        try:
            a, b, c = int(parts[0]), int(parts[1]), int(parts[2])
        except ValueError:
            return None
        if c < 100:
            c += 2000 if c < 70 else 1900
        if a < 100 and c > 31:
            a += 2000 if a < 70 else 1900
        # Prefer dd-mm-yyyy when year is last; else yyyy-mm-dd
        for triple in ((c, b, a), (a, b, c)):
            try:
                return date(*triple)
            except ValueError:
                continue
    return None


class SafeDate(TypeDecorator):
    """Date column that tolerates corrupt Access/SQLite strings (returns None)."""

    impl = String(32)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        parsed = parse_loose_date(value)
        return parsed.isoformat() if parsed else None

    def process_result_value(self, value, dialect):
        return parse_loose_date(value)

    @property
    def python_type(self):
        return date


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
