from __future__ import annotations

import logging
import re
import sqlite3
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


def _drop_schema_object(path: Path, name: str) -> bool:
    """Remove one unreadable schema entry so the rest of the file can open."""
    conn = sqlite3.connect(path, timeout=30)
    try:
        if hasattr(conn, "setconfig"):
            conn.setconfig(sqlite3.SQLITE_DBCONFIG_WRITABLE_SCHEMA, True)
        else:
            conn.execute("PRAGMA writable_schema=ON")
        rows = conn.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name=?",
            (name,),
        ).fetchall()
        if not rows:
            return False
        removed = conn.execute("DELETE FROM sqlite_master WHERE name=?", (name,))
        conn.commit()
        note = path.with_name(path.name + ".schema-repair.log")
        with note.open("a", encoding="utf-8") as handle:
            for row in rows:
                handle.write(repr(row) + "\n")
        _log.warning("Removed unreadable schema object %s (%s rows) from %s", name, removed.rowcount, path)
        return removed.rowcount > 0
    finally:
        conn.close()


def repair_malformed_schema() -> None:
    """Drop a schema entry SQLite cannot parse, such as the server object named K1.

    Core plant tables are left untouched. A readable database is not modified.
    """
    path = _sqlite_file()
    if path is None or not path.is_file():
        return
    for _ in range(8):
        conn = sqlite3.connect(path, timeout=30)
        try:
            conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
            return
        except sqlite3.DatabaseError as exc:
            broken = _schema_object_name(exc)
        finally:
            conn.close()
        if broken is None or broken in _CORE_SCHEMA:
            _log.error("SQLite schema is unreadable and was not modified: %s", broken or "unknown")
            return
        if not _drop_schema_object(path, broken):
            return


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
