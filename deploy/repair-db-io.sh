#!/usr/bin/env bash
# The site answers "disk I/O error" when SQLite was interrupted mid-write
# or WAL was turned on over the old Access schema.
# Works on the plant server with or without Docker.
#
#   bash deploy/repair-db-io.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

repair_file() {
  local db="$1"
  local py="python3"
  if [[ -x "$ROOT/backend/venv/bin/python" ]]; then
    py="$ROOT/backend/venv/bin/python"
  elif [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    py="$ROOT/backend/.venv/bin/python"
  fi
  "$py" - "$db" <<'PY'
import sqlite3
import sys
from pathlib import Path

live = Path(sys.argv[1])

def probe(path: Path):
    try:
        con = sqlite3.connect(str(path), timeout=20)
        try:
            con.execute("PRAGMA mmap_size=0")
            users = con.execute("SELECT count(*) FROM users").fetchone()[0]
            mode = con.execute("PRAGMA journal_mode").fetchone()
            if mode and str(mode[0]).lower() == "wal":
                con.execute("PRAGMA journal_mode=DELETE")
                print("switched journal to DELETE")
        finally:
            con.close()
    except Exception as exc:
        print(f"unreadable {path}: {exc}")
        return str(exc)
    print(f"readable {path} users={users}")
    return None

def park(path: Path) -> None:
    for suffix in ("-journal", "-wal", "-shm"):
        side = Path(str(path) + suffix)
        if not side.is_file():
            continue
        aside = Path(str(side) + ".aside")
        if aside.exists():
            aside.unlink()
        print(f"moving {side.name} aside")
        side.replace(aside)

if not live.is_file():
    raise SystemExit(f"Database not found: {live}")
err = probe(live)
if err is None:
    raise SystemExit(0)
if "disk i/o" not in err.lower() and "malformed" not in err.lower() and "readonly" not in err.lower():
    raise SystemExit(2)
park(live)
raise SystemExit(0 if probe(live) is None else 2)
PY
}

if command -v docker >/dev/null 2>&1 && docker ps -aq --filter name='^pvc-arvand$' | grep -q .; then
  echo "Stopping container pvc-arvand ..."
  docker compose stop pvc-arvand
  cid="$(docker ps -aq --filter name='^pvc-arvand$' | head -n 1)"
  echo "Repairing the database inside the Docker volume ..."
  set +e
  docker run --rm --volumes-from "$cid" --entrypoint python "$(docker inspect -f '{{.Config.Image}}' "$cid")" - /data/pvc_arvand.db <<'PY'
import sqlite3, sys
from pathlib import Path
live = Path(sys.argv[1])
def probe(path):
    try:
        con = sqlite3.connect(str(path), timeout=20)
        try:
            con.execute("PRAGMA mmap_size=0")
            n = con.execute("SELECT count(*) FROM users").fetchone()[0]
            mode = con.execute("PRAGMA journal_mode").fetchone()
            if mode and str(mode[0]).lower() == "wal":
                con.execute("PRAGMA journal_mode=DELETE")
                print("switched journal to DELETE")
        finally:
            con.close()
    except Exception as exc:
        print(f"unreadable {path}: {exc}")
        return str(exc)
    print(f"readable {path} users={n}")
    return None
err = probe(live)
if err and ("disk i/o" in err.lower() or "malformed" in err.lower() or "readonly" in err.lower()):
    for suffix in ("-journal", "-wal", "-shm"):
        side = Path(str(live) + suffix)
        if side.is_file():
            aside = Path(str(side) + ".aside")
            if aside.exists():
                aside.unlink()
            print("moving", side.name, "aside")
            side.replace(aside)
    err = probe(live)
raise SystemExit(0 if err is None else 2)
PY
  status=$?
  set -e
  docker start "$cid" >/dev/null
  if [[ "$status" -ne 0 ]]; then
    echo "Database is still unreadable." >&2
    exit "$status"
  fi
  echo "Database opens. Reload the site."
  exit 0
fi

DB="${PVC_DATA_DIR:-$ROOT/backend/instance}/pvc_arvand.db"
if [[ ! -f "$DB" ]]; then
  DB="$ROOT/backend/instance/pvc_arvand.db"
fi
echo "Repairing $DB"

pid=""
cmd=""
cwd=""
if command -v ss >/dev/null 2>&1; then
  pid="$(ss -ltnp 2>/dev/null | sed -n 's/.*:8080 .*pid=\([0-9]*\).*/\1/p' | head -n 1 || true)"
fi
if [[ -z "$pid" ]] && command -v sudo >/dev/null 2>&1; then
  pid="$(sudo -n ss -ltnp 2>/dev/null | sed -n 's/.*:8080 .*pid=\([0-9]*\).*/\1/p' | head -n 1 || true)"
fi
if [[ -z "$pid" ]] && command -v pgrep >/dev/null 2>&1; then
  pid="$(pgrep -f 'app.server|uvicorn app.main' | head -n 1 || true)"
fi
if [[ -n "${pid}" && -r "/proc/${pid}/cmdline" ]]; then
  cmd="$(tr '\0' ' ' < "/proc/${pid}/cmdline")"
  cwd="$(readlink "/proc/${pid}/cwd" || true)"
  case "$cmd" in
    *python*|*uvicorn*)
      echo "Stopping API pid ${pid}"
      echo "$cmd"
      kill "$pid" 2>/dev/null || sudo kill "$pid" 2>/dev/null || true
      sleep 1
      ;;
    *)
      echo "Port 8080 is used by a process this script will not stop: $cmd" >&2
      pid=""
      cmd=""
      ;;
  esac
fi

set +e
repair_file "$DB"
status=$?
set -e

if [[ -n "$cmd" && -n "$cwd" && ! -d "/proc/${pid}" ]]; then
  echo "Starting the API again ..."
  # shellcheck disable=SC2086
  (cd "$cwd" && nohup $cmd >> "$ROOT/backend/instance/repair-restart.log" 2>&1 &)
  sleep 2
fi

if [[ "$status" -ne 0 ]]; then
  echo "Database is still unreadable: $DB" >&2
  exit "$status"
fi
echo "Database opens. Reload the site."
