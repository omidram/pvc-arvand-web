from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import String, TypeDecorator, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

connect_args = {"check_same_thread": False} if settings.DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(settings.DATABASE_URL, connect_args=connect_args, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


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
