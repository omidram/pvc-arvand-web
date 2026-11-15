"""HTTP client for ARIAORMS LogSheets Excel downloads and the cell-room shift report.

Login: POST /ajax/logindebug.aspx with username/password.
Download: GET /FileDownloader.aspx?logid=&StartDate=&EndDate=&action=logsheet
Shift report: POST /ViewShiftReport.aspx/LoadShiftReport (JSON), then FileDownloader.aspx?wrid=&action=writedreport.
Dates are Jalali without zero-padding (e.g. 1405-7-1).
"""
from __future__ import annotations

import http.cookiejar
import json
import logging
import re
import ssl
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from typing import Any, Iterable
from urllib.parse import urlparse

from .plant_import import format_jalali_aria, gregorian_to_jalali

logger = logging.getLogger("pvc_arvand.ariaorms")
_UA = "Mozilla/5.0 (compatible; PVC-Arvand-VoltageSync/2.21)"

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
    req = urllib.request.Request(
        f"{base}/ajax/logindebug.aspx",
        data=data,
        headers={"User-Agent": _UA},
    )
    result = opener.open(req, timeout=40).read().decode("utf-8", "replace").strip()
    if result.lower() != "true":
        raise RuntimeError(f"AriaORMS login failed: {result[:120]}")


def new_opener(base: str, username: str, password: str) -> urllib.request.OpenerDirector:
    jar = http.cookiejar.CookieJar()
    handlers: list[Any] = [urllib.request.HTTPCookieProcessor(jar)]
    if base.lower().startswith("https"):
        # The plant ORMS host uses an internal certificate; the server only talks to this one address.
        context = ssl.create_default_context()
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE
        handlers.append(urllib.request.HTTPSHandler(context=context))
    opener = urllib.request.build_opener(*handlers)
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
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            body = opener.open(req, timeout=180).read()
            if body[:2] != b"PK":
                raise RuntimeError(f"not an xlsx ({len(body)} bytes)")
            return body
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            message = str(exc)
            if "not an xlsx" in message:
                raise RuntimeError(message) from exc
            time.sleep(1 + attempt)
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


def format_jalali_padded(day: date) -> str:
    """Shift-report date box: 1405-07-23."""
    year, month, day_no = gregorian_to_jalali(day.year, day.month, day.day)
    return f"{year}-{month:02d}-{day_no:02d}"


def _read(opener: urllib.request.OpenerDirector, url: str, data: bytes | None = None) -> tuple[bytes, str]:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": _UA})
    with opener.open(req, timeout=120) as response:
        body = response.read()
        disposition = response.headers.get("Content-Disposition") or ""
        ctype = response.headers.get("Content-Type") or ""
    return body, f"{ctype} {disposition}"


def _page_rotations(html: str) -> list[tuple[str, str]]:
    """The shift-report page lists its rotations in the ``WorkingRotation`` select."""
    match = re.search(r'(?is)<select[^>]*id=["\']WorkingRotation["\'][^>]*>(.*?)</select>', html)
    if not match:
        return []
    found: list[tuple[str, str]] = []
    for value, text in re.findall(r"(?is)<option[^>]*value=['\"]?([^'\" >]*)['\"]?[^>]*>(.*?)</option>", match.group(1)):
        label = " ".join(re.sub(r"<[^>]+>", " ", text).split())
        if value.strip() in {"", "0"} or not label:
            continue
        found.append((value.strip(), label))
    return found


def _report_id(html: str) -> str:
    """The cell-room shift report is the only entry of the ``TypeOfReport`` select."""
    match = re.search(r'(?is)<select[^>]*id=["\']TypeOfReport["\'][^>]*>(.*?)</select>', html)
    if not match:
        return "20"
    for value, _text in re.findall(r"(?is)<option([^>]*)>(.*?)</option>", match.group(1)):
        found = re.search(r"value=['\"]?(-?\d+)", value)
        if found and found.group(1) not in {"0", "-1"}:
            return found.group(1)
    return "20"


def _load_shift_html(opener: urllib.request.OpenerDirector, base: str, day: date, report_id: str, rotation_id: str) -> str:
    """ViewShiftReport.aspx/LoadShiftReport is the page's own ``Show`` button (a JSON web method)."""
    payload = json.dumps(
        {"pdate": format_jalali_aria(day), "reportid": report_id, "rotationid": rotation_id, "fieldReports": False}
    ).encode()
    request = urllib.request.Request(
        f"{base}/ViewShiftReport.aspx/LoadShiftReport",
        data=payload,
        headers={"Content-Type": "application/json; charset=utf-8", "User-Agent": _UA},
    )
    with opener.open(request, timeout=90) as response:
        data = json.loads(response.read().decode("utf-8", "replace"))
    return str(data.get("d") or "")


def fetch_cellroom_shifts(
    opener: urllib.request.OpenerDirector,
    base: str,
    start: date,
    end: date,
    *,
    username: str | None = None,
    password: str | None = None,
    page_url: str | None = None,
    only_day: date | None = None,
    only_kind: str | None = None,
) -> list[dict[str, Any]]:
    """Download the written cell-room shift report (xlsx) of every rotation for each day in the window.

    The page's Show button calls ``LoadShiftReport``; a written report carries a ``wrid`` and its Excel file is
    ``FileDownloader.aspx?wrid=<id>&action=writedreport``. Rotations that were not written yet answer
    "Report has not been written" and are skipped.
    """
    from .shift_report import parse_shift_xlsx

    page = (page_url or "").strip() or f"{base}/ViewShiftReport.aspx"
    body, _meta = _read(opener, page)
    html = body.decode("utf-8", "replace")
    if "LoadShiftReport" not in html and "TypeOfReport" not in html:
        raise RuntimeError("AriaORMS shift report page was not recognized (login rejected or wrong address)")
    report_id = _report_id(html)
    rotations = _page_rotations(html) or [("5", "12 صبح"), ("6", "12 شب")]
    if only_kind:
        from .shift_report import pick_rotations

        rotations = pick_rotations(rotations, only_kind)
        if not rotations:
            logger.warning("Shift report page has no rotation for %s", only_kind)
            return []
    if only_day is not None:
        start = end = only_day
    found: list[dict[str, Any]] = []
    seen: set[str] = set()
    day = start
    while day <= end:
        for index, (rotation_id, rotation_name) in enumerate(rotations):
            try:
                shift_html = _load_shift_html(opener, base, day, report_id, rotation_id)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Shift report %s %s failed: %s", day, rotation_name, exc)
                if username and password:
                    try:
                        login(opener, base, username, password)
                    except Exception:  # noqa: BLE001
                        logger.exception("AriaORMS re-login before the next shift failed")
                continue
            for wrid in dict.fromkeys(re.findall(r"wrid=(\d+)&(?:amp;)?action=writedreport", shift_html)):
                if wrid in seen:
                    continue
                seen.add(wrid)
                excel, _meta = _read(opener, f"{base}/FileDownloader.aspx?wrid={wrid}&action=writedreport")
                if excel[:2] != b"PK":
                    logger.warning("Shift report wrid %s is not an xlsx (%d bytes)", wrid, len(excel))
                    continue
                parsed = parse_shift_xlsx(excel, fallback_date=day, rotation=rotation_name, shift_index=0)
                if parsed and parsed.get("units"):
                    parsed["wrid"] = wrid
                    found.append(parsed)
        if day >= end:
            break
        day += timedelta(days=1)
    return found
