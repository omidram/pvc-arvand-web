"""Pull Rectifier Room Train 1 and Train 2 DC voltage and current.

Credentials come from ARIA_USER and ARIA_PASS. Cell voltages stay in
voltage_readings; these rows go to rectifier_readings.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
import urllib.parse
import urllib.request
import http.cookiejar
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from sqlalchemy import text

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.database import SessionLocal  # noqa: E402
from app.plant_import import parse_rectifier_excel  # noqa: E402

BASE = os.environ.get("ARIA_BASE", "http://192.168.20.12:8080").rstrip("/")
STATE_PATH = BACKEND / "instance" / "ariaorms_rectifier_state.json"

# EM / Site rectifier-room log sheets.
ROOMS = [(219, "Train 1"), (220, "Train 2")]


def month_ranges() -> list[tuple[str, str, str]]:
    ranges: list[tuple[str, str, str]] = []
    year, month = 1403, 7
    while (year, month) <= (1405, 7):
        if month <= 6:
            last = 31
        elif month <= 11:
            last = 30
        else:
            last = 29
        if (year, month) == (1405, 7):
            last = 7
        ranges.append((f"{year}-{month}", f"{year}-{month}-1", f"{year}-{month}-{last}"))
        month += 1
        if month == 13:
            month = 1
            year += 1
    return ranges


def login(opener: urllib.request.OpenerDirector) -> None:
    user = os.environ.get("ARIA_USER", "")
    password = os.environ.get("ARIA_PASS", "")
    if not user or not password:
        raise SystemExit("Set ARIA_USER and ARIA_PASS")
    data = urllib.parse.urlencode({"username": user, "password": password, "captcha": ""}).encode()
    req = urllib.request.Request(f"{BASE}/ajax/logindebug.aspx", data=data)
    result = opener.open(req, timeout=40).read().decode("utf-8", "replace").strip()
    if result.lower() != "true":
        raise SystemExit(f"AriaORMS login failed: {result[:120]}")


def new_opener() -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login(opener)
    return opener


def download(opener: urllib.request.OpenerDirector, log_id: int, start: str, end: str) -> bytes:
    url = f"{BASE}/FileDownloader.aspx?logid={log_id}&StartDate={start}&EndDate={end}&action=logsheet"
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            body = opener.open(url, timeout=300).read()
            if body[:2] != b"PK":
                raise RuntimeError(f"not an xlsx ({len(body)} bytes)")
            return body
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            time.sleep(2 + attempt * 3)
            login(opener)
    raise RuntimeError(str(last_error))


def load_state() -> dict:
    if STATE_PATH.is_file():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"done": {}}


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def ensure_table(db) -> None:
    db.execute(
        text(
            """
            CREATE TABLE IF NOT EXISTS rectifier_readings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                electrolyzer VARCHAR(20) NOT NULL,
                date DATETIME NOT NULL,
                time VARCHAR(20) NOT NULL,
                voltage_vdc FLOAT,
                current_ka FLOAT
            )
            """
        )
    )
    db.execute(
        text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_rectifier_slot "
            "ON rectifier_readings (electrolyzer, date, time)"
        )
    )
    db.commit()


def store_rows(db, rows: list[dict]) -> int:
    if not rows:
        return 0
    payload = [
        {
            "electrolyzer": row["electrolyzer"],
            "date": f"{row['date']} 00:00:00",
            "time": row["time"],
            "voltage_vdc": row["voltage_vdc"],
            "current_ka": row["current_ka"],
        }
        for row in rows
    ]
    db.execute(
        text(
            """
            INSERT INTO rectifier_readings (electrolyzer, date, time, voltage_vdc, current_ka)
            VALUES (:electrolyzer, :date, :time, :voltage_vdc, :current_ka)
            ON CONFLICT(electrolyzer, date, time) DO UPDATE SET
                voltage_vdc = COALESCE(excluded.voltage_vdc, rectifier_readings.voltage_vdc),
                current_ka = COALESCE(excluded.current_ka, rectifier_readings.current_ka)
            """
        ),
        payload,
    )
    return len(payload)


def main() -> None:
    state = load_state()
    done: dict = state.setdefault("done", {})
    jobs = [(log_id, label, key, start, end) for log_id, label in ROOMS for key, start, end in month_ranges()]
    pending = [job for job in jobs if done.get(f"{job[0]}|{job[2]}") != "ok"]
    print(f"rectifier jobs {len(jobs)} pending {len(pending)}", flush=True)

    def fetch(job):
        log_id, _label, _key, start, end = job
        try:
            opener = new_opener()
            return job, download(opener, log_id, start, end), None
        except Exception as exc:  # noqa: BLE001
            return job, None, exc

    with SessionLocal() as db:
        db.execute(text("PRAGMA journal_mode=WAL"))
        db.execute(text("PRAGMA busy_timeout=30000"))
        ensure_table(db)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(fetch, job) for job in pending]
            for index, future in enumerate(as_completed(futures), start=1):
                job, content, error = future.result()
                log_id, label, key, start, end = job
                token = f"{log_id}|{key}"
                print(f"[{index}/{len(pending)}] {label} {start}..{end}", flush=True)
                if error or content is None:
                    done[token] = f"error: {error}"
                    save_state(state)
                    print(f"  ERROR {error}", flush=True)
                    continue
                try:
                    parsed = parse_rectifier_excel(content)
                    if parsed.get("error") and not parsed.get("rows"):
                        done[token] = "ok"
                        save_state(state)
                        print("  empty sheet", flush=True)
                        continue
                    count = store_rows(db, parsed.get("rows") or [])
                    db.commit()
                    done[token] = "ok"
                    save_state(state)
                    print(f"  upserted {count}", flush=True)
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    done[token] = f"error: {exc}"
                    save_state(state)
                    print(f"  ERROR {exc}", flush=True)
                    traceback.print_exc()
    print("rectifier import finished", flush=True)


if __name__ == "__main__":
    main()
