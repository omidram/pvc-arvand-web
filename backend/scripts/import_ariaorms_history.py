"""Pull EM Site electrolyzer log sheets from AriaORMS into voltage history.

Credentials come from ARIA_USER and ARIA_PASS. Progress is stored in
instance/ariaorms_history_state.json so a stopped run can continue.
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
from app.voltage_sync import apply_excel_bytes, ensure_voltage_indexes  # noqa: E402
from app import alerts_engine  # noqa: E402

BASE = os.environ.get("ARIA_BASE", "http://192.168.20.12:8080").rstrip("/")
STATE_PATH = BACKEND / "instance" / "ariaorms_history_state.json"

# EM / Site electrolyzer log-sheet ids from AriaORMS.
ELECTROLYZERS = [
    ("A1", 170), ("B1", 171), ("C1", 172), ("D1", 173), ("E1", 174), ("F1", 175),
    ("G1", 176), ("H1", 177), ("J1", 178), ("K1", 179), ("L1", 180), ("M1", 181),
    ("A2", 182), ("B2", 183), ("C2", 184), ("D2", 185), ("E2", 186), ("F2", 187),
    ("G2", 188), ("H2", 189), ("J2", 190), ("K2", 191), ("L2", 192), ("M2", 193),
]
ONLY = {item.strip().upper() for item in os.environ.get("ARIA_ONLY", "").split(",") if item.strip()}
FORCE = os.environ.get("ARIA_FORCE", "").strip().lower() in {"1", "true", "yes"}
if ONLY:
    ELECTROLYZERS = [item for item in ELECTROLYZERS if item[0] in ONLY]


def month_ranges() -> list[tuple[str, str, str]]:
    """Jalali months from 1403/07 through 1405/07 (about two years, ending today)."""
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
            last = 8
        start = f"{year}-{month}-1"
        end = f"{year}-{month}-{last}"
        ranges.append((f"{year}-{month}", start, end))
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
            response = opener.open(url, timeout=300)
            body = response.read()
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


def main() -> None:
    state = load_state()
    done: dict = state.setdefault("done", {})
    ranges = month_ranges()
    jobs = [(name, log_id, key, start, end) for name, log_id in ELECTROLYZERS for key, start, end in ranges]
    pending = [job for job in jobs if FORCE or done.get(f"{job[0]}|{job[2]}") != "ok"]
    print(f"jobs {len(jobs)} pending {len(pending)} force={FORCE} only={sorted(ONLY) or 'all'}", flush=True)

    def fetch(job):
        name, log_id, _key, start, end = job
        try:
            opener = new_opener()
            content = download(opener, log_id, start, end)
            return job, content, None
        except Exception as exc:  # noqa: BLE001
            return job, None, exc

    with SessionLocal() as db:
        db.execute(text("PRAGMA journal_mode=WAL"))
        db.execute(text("PRAGMA busy_timeout=30000"))
        ensure_voltage_indexes(db)
        with ThreadPoolExecutor(max_workers=2) as pool:
            futures = [pool.submit(fetch, job) for job in pending]
            for index, future in enumerate(as_completed(futures), start=1):
                job, content, error = future.result()
                name, _log_id, key, start, end = job
                token = f"{name}|{key}"
                print(f"[{index}/{len(pending)}] {name} {start}..{end}", flush=True)
                if error or content is None:
                    done[token] = f"error: {error}"
                    save_state(state)
                    print(f"  ERROR {error}", flush=True)
                    continue
                try:
                    info = apply_excel_bytes(
                        db,
                        content,
                        electrolyzer=name,
                        hint_from_name=name,
                        evaluate_alerts=False,
                    )
                    db.commit()
                    done[token] = "ok"
                    state["last"] = {
                        "token": token,
                        "rows": info.get("rows_upserted"),
                        "dates": len(info.get("dates") or []),
                    }
                    save_state(state)
                    print(
                        f"  upserted {info.get('rows_upserted')} days {len(info.get('dates') or [])}",
                        flush=True,
                    )
                except Exception as exc:  # noqa: BLE001
                    db.rollback()
                    message = str(exc)
                    if "Header row with Parameter" in message:
                        done[token] = "ok"
                        save_state(state)
                        print("  empty sheet", flush=True)
                        continue
                    done[token] = f"error: {message}"
                    save_state(state)
                    print(f"  ERROR {exc}", flush=True)
                    traceback.print_exc()
        alerts_engine.ensure_default_rules(db)
        if os.environ.get("ARIA_SKIP_ALERTS", "").strip().lower() not in {"1", "true", "yes"}:
            created = alerts_engine.evaluate_voltage_rules(db)
            db.commit()
            print(f"alerts evaluated, new {created}", flush=True)
        else:
            print("alerts skipped", flush=True)


if __name__ == "__main__":
    main()
