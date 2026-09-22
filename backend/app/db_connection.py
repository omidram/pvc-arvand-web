"""Local vs online database connection profile.

The profile is stored next to the plant data (not inside the database) so the
app can read it before opening an engine. Env DATABASE_URL still wins, which
is how Docker / servers pin a connection.
"""
from __future__ import annotations

import json
import os
import sqlite3
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote_plus, urlparse

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from .paths import data_root, seed_db_path

PROFILE_NAME = "db_connection.json"
LOCAL_DB_NAME = "pvc_arvand.db"


def local_sqlite_path() -> Path:
    return data_root() / LOCAL_DB_NAME


def default_local_url() -> str:
    return f"sqlite:///{local_sqlite_path().as_posix()}"


def profile_path() -> Path:
    return data_root() / PROFILE_NAME


def load_profile() -> dict:
    path = profile_path()
    if not path.is_file():
        return {"mode": "local", "online": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"mode": "local", "online": {}}
    if not isinstance(data, dict):
        return {"mode": "local", "online": {}}
    data.setdefault("mode", "local")
    data.setdefault("online", {})
    return data


def save_profile(profile: dict) -> dict:
    payload = {
        "mode": profile.get("mode") or "local",
        "online": profile.get("online") or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    path = profile_path()
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return payload


def env_overrides_url() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


def sqlite_path_from_url(url: str) -> Path | None:
    if not url.startswith("sqlite"):
        return None
    rest = url.split(":///", 1)[-1]
    if not rest or rest == ":memory:":
        return None
    return Path(rest).resolve()


def mask_url(url: str) -> str:
    parsed = urlparse(url)
    if parsed.password is None:
        return url
    user = parsed.username or ""
    host = parsed.hostname or ""
    port = f":{parsed.port}" if parsed.port else ""
    return f"{parsed.scheme}://{user}:***{port}@{host}{parsed.path}"


def build_url(payload: dict) -> str:
    raw = (payload.get("url") or "").strip()
    if raw:
        return raw
    kind = (payload.get("kind") or "postgresql").strip().lower()
    if kind == "sqlite":
        path = Path((payload.get("sqlite_path") or "").strip())
        if not path.as_posix():
            raise ValueError("A database file path is required.")
        return f"sqlite:///{path.expanduser().resolve().as_posix()}"
    host = (payload.get("host") or "").strip()
    database = (payload.get("database") or "").strip()
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    port = int(payload.get("port") or 5432)
    if not host or not database or not username:
        raise ValueError("Host, database name, and username are required.")
    return (
        f"postgresql+psycopg://{quote_plus(username)}:{quote_plus(str(password))}"
        f"@{host}:{port}/{quote_plus(database)}"
    )


def resolve_database_url(fallback: str | None = None) -> str:
    if env_overrides_url():
        return os.environ["DATABASE_URL"]
    profile = load_profile()
    if profile.get("mode") == "online":
        try:
            return build_url(profile.get("online") or {})
        except ValueError:
            pass
    return fallback or default_local_url()


def test_url(url: str) -> dict:
    engine = create_engine(url, pool_pre_ping=True, connect_args=_connect_args(url))
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            dialect = conn.dialect.name
    finally:
        engine.dispose()
    return {"ok": True, "dialect": dialect, "url_display": mask_url(url)}


def _connect_args(url: str) -> dict:
    return {"check_same_thread": False} if url.startswith("sqlite") else {}


def _file_info(key: str, label: str, section: str, path: Path, *, in_use: bool = False) -> dict:
    exists = path.exists()
    stat = path.stat() if exists else None
    return {
        "key": key,
        "label": label,
        "section": section,
        "path": str(path.resolve()) if path.exists() or path.parent.exists() else str(path),
        "exists": exists,
        "is_dir": path.is_dir() if exists else False,
        "size_bytes": stat.st_size if stat and path.is_file() else None,
        "modified_at": datetime.utcfromtimestamp(stat.st_mtime).isoformat() + "Z" if stat else None,
        "in_use": in_use,
    }


def _count_rows(conn, table: str) -> int:
    try:
        return int(conn.execute(text(f'SELECT COUNT(*) FROM "{table.replace(chr(34), chr(34)*2)}"')).scalar() or 0)
    except Exception:
        return 0


def _table_sections(engine: Engine) -> list[dict]:
    from .access_archive import META_TABLE, SQLITE_PREFIX

    inspector = inspect(engine)
    names = inspector.get_table_names()
    system = {"users", "form_permissions", "backup_settings"}
    archive_meta = META_TABLE
    groups = {
        "system": [],
        "application": [],
        "archive": [],
    }
    with engine.connect() as conn:
        for name in names:
            row = {"name": name, "rows": _count_rows(conn, name)}
            if name.startswith(SQLITE_PREFIX) or name == archive_meta:
                groups["archive"].append(row)
            elif name in system:
                groups["system"].append(row)
            else:
                groups["application"].append(row)

    def pack(key: str, label: str, tables: list[dict]) -> dict:
        tables = sorted(tables, key=lambda t: t["name"])
        return {
            "key": key,
            "label": label,
            "table_count": len(tables),
            "row_count": sum(t["rows"] for t in tables),
            "tables": tables,
        }

    return [
        pack("application", "Application tables", groups["application"]),
        pack("archive", "Access archive tables", groups["archive"]),
        pack("system", "Users & system tables", groups["system"]),
    ]


def inventory(*, live_url: str) -> dict:
    profile = load_profile()
    online = dict(profile.get("online") or {})
    online.pop("password", None)
    online["password_set"] = bool((profile.get("online") or {}).get("password"))
    live_path = sqlite_path_from_url(live_url)
    local_path = local_sqlite_path()
    data_dir = data_root()
    files = [
        _file_info("data_dir", "Application data folder", "folders", data_dir, in_use=True),
        _file_info("local_db", "Local SQLite database", "database", local_path, in_use=bool(live_path and live_path == local_path.resolve())),
        _file_info("local_wal", "SQLite write-ahead log", "database", Path(str(local_path) + "-wal")),
        _file_info("local_shm", "SQLite shared-memory file", "database", Path(str(local_path) + "-shm")),
        _file_info("profile", "Connection profile", "database", profile_path(), in_use=profile.get("mode") == "online"),
        _file_info("jwt", "Signing key", "security", data_dir / "jwt_secret.txt"),
        _file_info("backups_dir", "Backups folder", "folders", data_dir / "backups"),
    ]
    seed = seed_db_path()
    if seed:
        files.append(_file_info("seed", "Bundled seed database", "bundled", seed))
    if live_path and live_path.resolve() != local_path.resolve():
        files.insert(1, _file_info("active_db", "Active SQLite database", "database", live_path, in_use=True))
        files.insert(2, _file_info("active_wal", "Active write-ahead log", "database", Path(str(live_path) + "-wal")))
        files.insert(3, _file_info("active_shm", "Active shared-memory file", "database", Path(str(live_path) + "-shm")))

    optional_missing = {"local_wal", "local_shm", "active_wal", "active_shm"}
    files = [item for item in files if item["exists"] or item["key"] not in optional_missing]

    backups_dir = data_dir / "backups"
    if backups_dir.is_dir():
        for backup in sorted(backups_dir.glob("pvc_arvand_backup_*.db"), key=lambda p: p.stat().st_mtime, reverse=True):
            files.append(_file_info(f"backup:{backup.name}", backup.name, "backups", backup))

    from .database import engine

    dialect = engine.dialect.name
    try:
        sections = _table_sections(engine)
    except Exception:
        sections = []

    mode = "env" if env_overrides_url() else (profile.get("mode") or "local")
    return {
        "mode": mode,
        "dialect": dialect,
        "url_display": mask_url(live_url),
        "data_directory": str(data_dir),
        "local_sqlite_path": str(local_path),
        "env_locked": env_overrides_url(),
        "online": online,
        "files": files,
        "sections": sections,
        "can_download": True,
    }


def allowed_reveal_paths(live_url: str) -> set[Path]:
    out: set[Path] = set()
    for item in inventory(live_url=live_url)["files"]:
        try:
            out.add(Path(item["path"]).resolve())
        except OSError:
            continue
    return out


def reveal_path(path: Path) -> None:
    target = path if path.exists() else path.parent
    if not target.exists():
        raise FileNotFoundError(str(path))
    if os.name == "nt":
        if path.is_file():
            os.startfile(path.parent)  # noqa: S606
        else:
            os.startfile(target)  # noqa: S606
        return
    import subprocess

    subprocess.Popen(["xdg-open", str(target)])


def snapshot_sqlite_file(src: Path, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    src_conn = sqlite3.connect(str(src))
    dest_conn = sqlite3.connect(str(dest))
    try:
        src_conn.backup(dest_conn)
    finally:
        dest_conn.close()
        src_conn.close()
    return dest


def export_engine_to_sqlite(src_engine: Engine, dest: Path) -> Path:
    """Copy every table from the live engine into a portable SQLite file."""
    from .database import Base

    if dest.exists():
        dest.unlink()
    dest_engine = create_engine(f"sqlite:///{dest.as_posix()}", connect_args={"check_same_thread": False})
    try:
        Base.metadata.create_all(bind=dest_engine)
        _copy_all_tables(src_engine, dest_engine)
    finally:
        dest_engine.dispose()
    return dest


def make_download_file(live_url: str) -> tuple[Path, str, bool]:
    """Returns (path, filename, delete_after)."""
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    filename = f"pvc_arvand_{stamp}.db"
    src = sqlite_path_from_url(live_url)
    if src and src.is_file():
        dest = Path(tempfile.mkdtemp(prefix="pvc-db-")) / filename
        snapshot_sqlite_file(src, dest)
        return dest, filename, True
    dest = Path(tempfile.mkdtemp(prefix="pvc-db-")) / filename
    from .database import engine

    export_engine_to_sqlite(engine, dest)
    return dest, filename, True


def _copy_all_tables(src_engine: Engine, dest_engine: Engine) -> dict:
    from .access_archive import META_TABLE, SQLITE_PREFIX
    from .database import Base

    Base.metadata.create_all(bind=dest_engine)
    copied = 0
    skipped = 0
    dest_inspector = inspect(dest_engine)
    dest_tables = set(dest_inspector.get_table_names())
    src_inspector = inspect(src_engine)
    src_tables = set(src_inspector.get_table_names())

    with src_engine.connect() as src, dest_engine.begin() as dest:
        for table in Base.metadata.sorted_tables:
            if table.name not in src_tables:
                skipped += 1
                continue
            rows = [dict(row) for row in src.execute(table.select()).mappings()]
            dest.execute(table.delete())
            if rows:
                dest.execute(table.insert(), rows)
            copied += len(rows)

        archive_tables = [name for name in src_tables if name.startswith(SQLITE_PREFIX) or name == META_TABLE]
        for name in archive_tables:
            _copy_raw_table(src, dest, dest_engine, name, dest_tables)
            dest_tables.add(name)

    _reset_postgres_sequences(dest_engine)
    return {"rows": copied, "skipped_tables": skipped}


def _copy_raw_table(src_conn, dest_conn, dest_engine: Engine, name: str, dest_tables: set[str]) -> None:
    quoted = '"' + name.replace('"', '""') + '"'
    rows = src_conn.execute(text(f"SELECT * FROM {quoted}")).mappings().all()
    columns = list(rows[0].keys()) if rows else [col["name"] for col in inspect(src_conn).get_columns(name)]
    if name not in dest_tables:
        dialect = dest_engine.dialect.name
        pk = (
            "_rowid INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY"
            if dialect == "postgresql" and "_rowid" in columns
            else None
        )
        col_sql = []
        for col in columns:
            if pk and col == "_rowid":
                col_sql.append(pk)
            else:
                col_sql.append(f'"{col.replace(chr(34), chr(34)*2)}" TEXT')
        dest_conn.execute(text(f"CREATE TABLE IF NOT EXISTS {quoted} ({', '.join(col_sql)})"))
    dest_conn.execute(text(f"DELETE FROM {quoted}"))
    if not rows:
        return
    col_list = ", ".join('"' + c.replace('"', '""') + '"' for c in columns)
    placeholders = ", ".join(f":c{i}" for i in range(len(columns)))
    payload = [{f"c{i}": row.get(col) for i, col in enumerate(columns)} for row in rows]
    dest_conn.execute(text(f"INSERT INTO {quoted} ({col_list}) VALUES ({placeholders})"), payload)


def _reset_postgres_sequences(engine: Engine) -> None:
    if engine.dialect.name != "postgresql":
        return
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in inspector.get_table_names():
            pk = inspector.get_pk_constraint(table).get("constrained_columns") or []
            if len(pk) != 1:
                continue
            col = pk[0]
            col_type = str(next((c["type"] for c in inspector.get_columns(table) if c["name"] == col), ""))
            if "INT" not in col_type.upper():
                continue
            qtable = table.replace('"', '""')
            qcol = col.replace('"', '""')
            conn.execute(
                text(
                    f"""
                    SELECT setval(
                        pg_get_serial_sequence('"{qtable}"', '{qcol}'),
                        COALESCE((SELECT MAX("{qcol}") FROM "{qtable}"), 1),
                        true
                    )
                    """
                )
            )


def apply_switch(payload: dict, *, live_url: str) -> dict:
    if env_overrides_url():
        raise RuntimeError("DATABASE_URL is set in the environment, so the connection cannot be changed here.")
    mode = (payload.get("mode") or "local").strip().lower()
    if mode not in {"local", "online"}:
        raise ValueError("Mode must be local or online.")
    copy_data = bool(payload.get("copy_data"))
    online = {
        "kind": (payload.get("kind") or "postgresql").strip().lower(),
        "host": (payload.get("host") or "").strip(),
        "port": int(payload.get("port") or 5432),
        "database": (payload.get("database") or "").strip(),
        "username": (payload.get("username") or "").strip(),
        "sqlite_path": (payload.get("sqlite_path") or "").strip(),
        "url": (payload.get("url") or "").strip(),
    }
    existing = load_profile().get("online") or {}
    password = payload.get("password")
    if password in (None, "") and existing.get("password"):
        online["password"] = existing["password"]
    elif password:
        online["password"] = password

    if mode == "online":
        target_url = build_url(online)
        test_url(target_url)
    else:
        target_url = default_local_url()
        Path(local_sqlite_path()).parent.mkdir(parents=True, exist_ok=True)

    copied = None
    if copy_data and target_url != live_url:
        from .database import engine

        dest_engine = create_engine(target_url, pool_pre_ping=True, connect_args=_connect_args(target_url))
        try:
            copied = _copy_all_tables(engine, dest_engine)
        finally:
            dest_engine.dispose()
    elif mode == "online":
        dest_engine = create_engine(target_url, pool_pre_ping=True, connect_args=_connect_args(target_url))
        try:
            from .database import Base

            Base.metadata.create_all(bind=dest_engine)
        finally:
            dest_engine.dispose()

    profile = save_profile({"mode": mode, "online": online if mode == "online" else existing})
    return {
        "ok": True,
        "mode": profile["mode"],
        "url_display": mask_url(target_url),
        "restart_required": True,
        "copied": copied,
    }
