"""HTTP client for ARIAORMS LogSheets Excel downloads.

Login: POST /ajax/logindebug.aspx with username/password.
Download: GET /FileDownloader.aspx?logid=&StartDate=&EndDate=&action=logsheet
Dates are Jalali without zero-padding (e.g. 1405-7-1).
"""
from __future__ import annotations

import http.cookiejar
import logging
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Iterable
from urllib.parse import urlparse

from .plant_import import format_jalali_aria

logger = logging.getLogger("pvc_arvand.ariaorms")

DEFAULT_BASE = "http://192.168.20.12:8080"

# EM / Site electrolyzer log-sheet ids from AriaORMS.
ELECTROLYZER_LOG_IDS: list[tuple[str, int]] = [
    ("A1", 170), ("B1", 171), ("C1", 172), ("D1", 173), ("E1", 174), ("F1", 175),
    ("G1", 176), ("H1", 177), ("J1", 178), ("K1", 179), ("L1", 180), ("M1", 181),
    ("A2", 182), ("B2", 183), ("C2", 184), ("D2", 185), ("E2", 186), ("F2", 187),
    ("G2", 188), ("H2", 189), ("J2", 190), ("K2", 191), ("L2", 192), ("M2", 193),
]


def normalize_base_url(source_url: str | None) -> str:
    raw = (source_url or DEFAULT_BASE).strip() or DEFAULT_BASE
    if "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return DEFAULT_BASE


def login(opener: urllib.request.OpenerDirector, base: str, username: str, password: str) -> None:
    data = urllib.parse.urlencode(
        {"username": username, "password": password, "captcha": ""}
    ).encode()
    req = urllib.request.Request(f"{base}/ajax/logindebug.aspx", data=data)
    result = opener.open(req, timeout=40).read().decode("utf-8", "replace").strip()
    if result.lower() != "true":
        raise RuntimeError(f"AriaORMS login failed: {result[:120]}")


def new_opener(base: str, username: str, password: str) -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login(opener, base, username, password)
    return opener


def download_logsheet(
    opener: urllib.request.OpenerDirector,
    base: str,
    log_id: int,
    start: date | str,
    end: date | str,
    *,
    username: str | None = None,
    password: str | None = None,
) -> bytes:
    start_s = start if isinstance(start, str) else format_jalali_aria(start)
    end_s = end if isinstance(end, str) else format_jalali_aria(end)
    url = (
        f"{base}/FileDownloader.aspx?logid={log_id}"
        f"&StartDate={start_s}&EndDate={end_s}&action=logsheet"
    )
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
            if username and password:
                try:
                    login(opener, base, username, password)
                except Exception:  # noqa: BLE001
                    logger.exception("AriaORMS re-login failed")
    raise RuntimeError(str(last_error))


def date_window(*, end: date | None = None, lookback_days: int = 1, include_today: bool = False) -> tuple[date, date]:
    """Return inclusive Gregorian [start, end] for AriaORMS download."""
    end_day = end or date.today()
    if not include_today:
        end_day = end_day - timedelta(days=1)
    days = max(1, int(lookback_days or 1))
    start_day = end_day - timedelta(days=days - 1)
    return start_day, end_day


def iter_electrolyzers(only: Iterable[str] | None = None) -> list[tuple[str, int]]:
    if not only:
        return list(ELECTROLYZER_LOG_IDS)
    wanted = {name.strip().upper() for name in only if name and name.strip()}
    return [item for item in ELECTROLYZER_LOG_IDS if item[0] in wanted]
