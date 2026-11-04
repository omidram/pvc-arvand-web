#!/usr/bin/env bash
# Plant server update. No Docker.
# Stops the program, pulls GitHub main, repairs SQLite, then starts the
# API (port 8010, only on the server), the website (port 3000), and checks both plus the database.
# Operators open http://192.168.20.25:3000/
#
#   bash deploy/update.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PHASE="${1:-}"
INSTANCE="$ROOT/backend/instance"
LOG_DIR="$INSTANCE/logs"
DB="$INSTANCE/pvc_arvand.db"
BACK_PORT="${APP_API_PORT:-8010}"
FRONT_PORT="${APP_PUBLISH_PORT:-3000}"
mkdir -p "$LOG_DIR" "$INSTANCE/backups"

if [[ ! -d "$ROOT/.git" ]]; then
  echo "این پوشه مخزن گیت نیست." >&2
  exit 1
fi

say() { printf '\n== %s\n' "$*"; }

python_bin() {
  if [[ -x "$ROOT/backend/venv/bin/python" ]]; then
    echo "$ROOT/backend/venv/bin/python"
  elif [[ -x "$ROOT/backend/.venv/bin/python" ]]; then
    echo "$ROOT/backend/.venv/bin/python"
  else
    echo ""
  fi
}

cmdline() {
  tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null || true
}

is_app_pid() {
  local pid="$1" cmd cwd
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ "$pid" -eq $$ || "$pid" -eq "${PPID:-0}" ]] && return 1
  [[ -d "/proc/$pid" ]] || return 1
  cmd="$(cmdline "$pid")"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  case "$cmd" in
    *python*|*uvicorn*|*next*|*node*) ;;
    *) return 1 ;;
  esac
  [[ "$cmd" == *"$ROOT"* || "$cwd" == "$ROOT"* || "$cmd" == *app.server* || "$cmd" == *app.main:app* ]]
}

port_pids() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' || true
    sudo -n ss -ltnp "sport = :$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]*\).*/\1/p' || true
  fi
  if command -v fuser >/dev/null 2>&1; then
    fuser -n tcp "$port" 2>/dev/null | tr ' ' '\n' || true
  fi
}

stop_app() {
  say "خاموش کردن برنامه"
  local pid
  local -a pids=()
  if [[ -f "$INSTANCE/backend.pid" ]]; then pids+=("$(cat "$INSTANCE/backend.pid")"); fi
  if [[ -f "$INSTANCE/frontend.pid" ]]; then pids+=("$(cat "$INSTANCE/frontend.pid")"); fi
  while read -r pid; do
    [[ -n "$pid" ]] && pids+=("$pid")
  done < <(port_pids "$BACK_PORT"; port_pids "$FRONT_PORT"; port_pids 8080; pgrep -f "$ROOT/(backend|frontend)" || true)
  local seen=" "
  if ((${#pids[@]})); then
    for pid in "${pids[@]}"; do
      [[ "$seen" == *" $pid "* ]] && continue
      is_app_pid "$pid" || continue
      seen+=" $pid "
      echo "توقف pid $pid — $(cmdline "$pid")"
      kill "$pid" 2>/dev/null || sudo -n kill "$pid" 2>/dev/null || true
    done
  fi
  sleep 1
  for pid in $seen; do
    [[ -d "/proc/$pid" ]] || continue
    echo "توقف اجباری pid $pid"
    kill -9 "$pid" 2>/dev/null || sudo -n kill -9 "$pid" 2>/dev/null || true
  done
  rm -f "$INSTANCE/backend.pid" "$INSTANCE/frontend.pid"
  sleep 1
}

repair_db() {
  say "بررسی پایگاه داده"
  if [[ ! -f "$DB" ]]; then
    echo "فایل پایگاه پیدا نشد: $DB" >&2
    exit 1
  fi
  local py
  py="$(python_bin)"
  [[ -n "$py" ]] || py="python3"
  "$py" - "$DB" <<'PY'
import sqlite3, sys
from pathlib import Path
live = Path(sys.argv[1])

def probe(path: Path):
    try:
        con = sqlite3.connect(str(path), timeout=30)
        try:
            con.execute("PRAGMA mmap_size=0")
            con.execute("PRAGMA busy_timeout=30000")
            users = con.execute("SELECT count(*) FROM users").fetchone()[0]
            shutdowns = con.execute("SELECT count(*) FROM shutdowns").fetchone()[0]
            mode = con.execute("PRAGMA journal_mode").fetchone()
            if mode and str(mode[0]).lower() == "wal":
                con.execute("PRAGMA journal_mode=DELETE")
                print("journal switched to DELETE")
        finally:
            con.close()
    except Exception as exc:
        print(f"unreadable: {exc}")
        return str(exc)
    print(f"users={users} shutdowns={shutdowns}")
    return None

err = probe(live)
if err and ("disk i/o" in err.lower() or "malformed" in err.lower() or "readonly" in err.lower()):
    for suffix in ("-journal", "-wal", "-shm"):
        side = Path(str(live) + suffix)
        if not side.is_file():
            continue
        aside = Path(str(side) + ".aside")
        if aside.exists():
            aside.unlink()
        print(f"moved {side.name} aside")
        side.replace(aside)
    err = probe(live)
if err:
    raise SystemExit(2)
PY
}

snapshot_db() {
  local free_kb db_kb stamp dest
  free_kb="$(df -Pk "$INSTANCE" | awk 'NR==2 {print $4}')"
  db_kb="$(du -k "$DB" | awk '{print $1}')"
  if (( free_kb < db_kb + 500000 )); then
    echo "فضای دیسک برای یک کپی کامل از پایگاه کافی نیست؛ کپی گرفته نشد تا خطای disk I/O تکرار نشود."
    return 0
  fi
  stamp="$(date +%Y%m%d_%H%M%S)"
  dest="$INSTANCE/backups/pre_update_${stamp}.db"
  echo "نسخه پشتیبان → $dest"
  cp -a "$DB" "$dest"
}

git_sync() {
  say "گرفتن آخرین نسخه از گیت‌هاب"
  mkdir -p "$ROOT/.git/info" "$INSTANCE/backups/sidecar-keep"
  grep -qxF 'backend/instance/' "$ROOT/.git/info/exclude" 2>/dev/null || echo 'backend/instance/' >> "$ROOT/.git/info/exclude"
  # The live journal must not block the pull, and git must not write its old copy back.
  local base
  for base in pvc_arvand.db-wal pvc_arvand.db-shm; do
    if [[ -f "$INSTANCE/$base" ]]; then
      cp -a "$INSTANCE/$base" "$INSTANCE/backups/sidecar-keep/$base"
      rm -f "$INSTANCE/$base"
    fi
    if git ls-files --error-unmatch "backend/instance/$base" >/dev/null 2>&1; then
      git update-index --no-skip-worktree "backend/instance/$base" 2>/dev/null || true
      git checkout -- "backend/instance/$base" 2>/dev/null || true
    fi
  done
  git fetch origin
  git pull --ff-only origin main
  rm -f "$INSTANCE/pvc_arvand.db-wal" "$INSTANCE/pvc_arvand.db-shm"
}

install_backend() {
  say "نصب بک‌اند"
  local py
  py="$(python_bin)"
  if [[ -z "$py" ]]; then
    python3 -m venv "$ROOT/backend/venv"
    py="$ROOT/backend/venv/bin/python"
  fi
  if ! "$py" -m pip install -q -r "$ROOT/backend/requirements.txt"; then
    echo "نصب کامل وابستگی‌ها نشد؛ نسخه بدون درایور Access نصب می‌شود."
    "$py" -m pip install -q -r "$ROOT/backend/requirements-docker.txt"
  fi
}

build_frontend() {
  say "ساخت فرانت‌اند"
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm نصب نیست. روی سرور: sudo apt-get install -y nodejs npm" >&2
    return 1
  fi
  (
    cd "$ROOT/frontend"
    npm install --silent
    NEXT_PUBLIC_SAME_ORIGIN=1 \
    PVC_BACKEND_URL="http://127.0.0.1:${BACK_PORT}" \
      npm run build
  )
}

start_backend() {
  say "اجرای بک‌اند روی پورت ${BACK_PORT}"
  local py
  py="$(python_bin)"
  cd "$ROOT/backend"
  APP_HOST=0.0.0.0 \
  APP_PORT="$BACK_PORT" \
  DATABASE_URL="sqlite:///${DB}" \
  nohup "$py" -m app.server >> "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$INSTANCE/backend.pid"
  cd "$ROOT"
}

start_frontend() {
  say "اجرای فرانت‌اند روی پورت ${FRONT_PORT}"
  cd "$ROOT/frontend"
  local next_bin="$ROOT/frontend/node_modules/next/dist/bin/next"
  if [[ ! -f "$next_bin" ]]; then
    echo "خروجی فرانت ساخته نشده است." >&2
    exit 1
  fi
  PVC_BACKEND_URL="http://127.0.0.1:${BACK_PORT}" \
  nohup node "$next_bin" start -H 0.0.0.0 -p "$FRONT_PORT" >> "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$INSTANCE/frontend.pid"
  cd "$ROOT"
}

wait_http() {
  local url="$1" i
  for i in $(seq 1 40); do
    if curl -fsS -m 3 "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

db_login_ok() {
  local port="$1" code body
  body="$LOG_DIR/login-check.json"
  code="$(curl -sS -m 20 -o "$body" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${port}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d '{"username":"__healthcheck__","password":"x"}' || true)"
  if [[ "$code" == "401" || "$code" == "400" || "$code" == "422" ]]; then
    return 0
  fi
  echo "ورود آزمایشی روی پورت ${port} کد ${code} برگرداند." >&2
  cat "$body" >&2 || true
  return 1
}

check_all() {
  say "بررسی سلامت"
  wait_http "http://127.0.0.1:${BACK_PORT}/health" || {
    echo "بک‌اند بالا نیامد. آخر لاگ:" >&2
    tail -n 40 "$LOG_DIR/backend.log" >&2 || true
    exit 1
  }
  db_login_ok "$BACK_PORT" || {
    echo "پایگاه از داخل بک‌اند خوانده نمی‌شود." >&2
    tail -n 40 "$LOG_DIR/backend.log" >&2 || true
    exit 1
  }
  wait_http "http://127.0.0.1:${FRONT_PORT}/" || {
    echo "فرانت‌اند بالا نیامد. آخر لاگ:" >&2
    tail -n 40 "$LOG_DIR/frontend.log" >&2 || true
    exit 1
  }
  db_login_ok "$FRONT_PORT" || {
    echo "فرانت‌اند به بک‌اند وصل نیست." >&2
    tail -n 20 "$LOG_DIR/frontend.log" >&2 || true
    exit 1
  }
  echo "بک‌اند سالم است: http://127.0.0.1:${BACK_PORT}/health"
  echo "سایت سالم است: http://192.168.20.25:${FRONT_PORT}/"
  echo "پایگاه خوانده شد و درخواست ورود به آن پاسخ داد."
}

if [[ "$PHASE" != "--run" ]]; then
  exec 9>"$INSTANCE/update.lock"
  if command -v flock >/dev/null 2>&1; then
    flock -n 9 || { echo "یک آپدیت دیگر در حال اجراست." >&2; exit 1; }
  fi
  stop_app
  if ! repair_db; then
    echo "پایگاه داده هنوز باز نمی‌شود. برنامه اجرا نشد تا داده کارخانه بازنویسی نشود." >&2
    exit 1
  fi
  snapshot_db
  if ! git_sync; then
    echo "گیت به‌روز نشد. همان نسخه قبلی دوباره اجرا می‌شود." >&2
  fi
  exec bash "$ROOT/deploy/update.sh" --run
fi

install_backend
if ! build_frontend; then
  echo "ساخت فرانت‌اند ناموفق بود." >&2
  if [[ ! -d "$ROOT/frontend/.next" ]]; then
    exit 1
  fi
  echo "همان نسخه قبلی فرانت‌اند اجرا می‌شود."
fi
start_backend
start_frontend
check_all
say "آپدیت تمام شد. از این به بعد فقط همین دستور را اجرا کنید: bash deploy/update.sh"
