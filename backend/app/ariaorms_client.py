"""HTTP client for ARIAORMS LogSheets Excel downloads and the cell-room shift report.

Login: POST /ajax/logindebug.aspx with username/password.
Download: GET /FileDownloader.aspx?logid=&StartDate=&EndDate=&action=logsheet
Shift report: POST /ViewShiftReport.aspx (گزارش کارکردی سلول‌ها).
Log-sheet dates are Jalali without zero-padding (e.g. 1405-7-1).
The shift-report date box uses zero-padding (1405-07-23).
"""
from __future__ import annotations

import http.cookiejar
import logging
import re
import time
import urllib.parse
import urllib.request
from datetime import date, timedelta
from html.parser import HTMLParser
from typing import Any, Iterable
from urllib.parse import urljoin, urlparse

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


class _FormParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.action = ""
        self.fields: list[tuple[str, str]] = []
        self.selects: list[dict[str, Any]] = []
        self.submits: list[tuple[str, str]] = []
        self._select: dict[str, Any] | None = None
        self._option: dict[str, Any] | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        attr = {key.lower(): value or "" for key, value in attrs}
        if tag == "form" and not self.action:
            self.action = attr.get("action") or ""
        elif tag == "input":
            name = attr.get("name") or ""
            kind = (attr.get("type") or "text").lower()
            if not name:
                return
            if kind == "submit":
                self.submits.append((name, attr.get("value") or ""))
            elif kind in {"checkbox", "radio"}:
                if "checked" in attr:
                    self.fields.append((name, attr.get("value") or "on"))
            elif kind != "button":
                self.fields.append((name, attr.get("value") or ""))
        elif tag == "button":
            name = attr.get("name") or ""
            if name:
                self.submits.append((name, attr.get("value") or ""))
        elif tag == "select":
            self._select = {"name": attr.get("name") or "", "options": [], "selected": ""}
        elif tag == "option" and self._select is not None:
            self._option = {
                "value": attr.get("value") or "",
                "selected": "selected" in attr,
            }
            self._text = []
        elif tag == "textarea":
            self._option = {"name": attr.get("name") or "", "textarea": True}
            self._text = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "option" and self._option is not None and self._select is not None:
            text = " ".join("".join(self._text).split())
            value = self._option["value"] or text
            self._select["options"].append((value, text))
            if self._option["selected"]:
                self._select["selected"] = value
            self._option = None
        elif tag == "select" and self._select is not None:
            if not self._select["selected"] and self._select["options"]:
                self._select["selected"] = self._select["options"][0][0]
            self.selects.append(self._select)
            self._select = None
        elif tag == "textarea" and self._option is not None:
            name = self._option.get("name") or ""
            if name:
                self.fields.append((name, "".join(self._text)))
            self._option = None

    def handle_data(self, data: str) -> None:
        if self._option is not None:
            self._text.append(data)


def _decode_page(body: bytes) -> str:
    for encoding in ("utf-8", "cp1256"):
        try:
            text = body.decode(encoding)
        except UnicodeDecodeError:
            continue
        if "VIEWSTATE" in text or "Shift" in text or "سلول" in text:
            return text
    return body.decode("utf-8", "replace")


def _read(opener: urllib.request.OpenerDirector, url: str, data: bytes | None = None) -> tuple[bytes, str]:
    req = urllib.request.Request(url, data=data, headers={"User-Agent": _UA})
    with opener.open(req, timeout=90) as response:
        body = response.read()
        disposition = response.headers.get("Content-Disposition") or ""
        ctype = response.headers.get("Content-Type") or ""
    return body, f"{ctype} {disposition}"


def _parse_form(html: str, page_url: str) -> dict[str, Any] | None:
    parser = _FormParser()
    parser.feed(html)
    parser.close()
    if not any(name == "__VIEWSTATE" for name, _value in parser.fields):
        return None
    report_name = ""
    report_value = ""
    rotation_name = ""
    rotations: list[tuple[str, str]] = []
    date_name = ""
    for select in parser.selects:
        options = select["options"]
        blob = " ".join(text for _value, text in options)
        if not report_name and ("سلول" in blob or "کارکرد" in blob):
            report_name = select["name"]
            report_value = select["selected"]
            for value, text in options:
                if "سلول" in text or "کارکرد" in text:
                    report_value = value
                    break
        elif not rotation_name and re.search(r"شب|صبح|عصر", blob):
            rotation_name = select["name"]
            rotations = [
                (value, text)
                for value, text in options
                if text.strip() and not re.search(r"انتخاب|select", text, re.I)
            ]
    for name, value in parser.fields:
        if date_name:
            break
        if re.match(r"^1[34]\d{2}-\d{1,2}-\d{1,2}$", value.strip()):
            date_name = name
    if not date_name:
        for name, _value in parser.fields:
            if re.search(r"date", name, re.I):
                date_name = name
                break
    show = next(((name, value) for name, value in parser.submits if re.search(r"show|نمایش", value, re.I)), None)
    excel = next(((name, value) for name, value in parser.submits if re.search(r"excel", value, re.I)), None)
    if show is None:
        target = next((item for item in re.findall(r"__doPostBack\('([^']+)'", html) if re.search(r"show|نمایش", item, re.I)), None)
        if target:
            show = ("__EVENTTARGET", target)
    if excel is None:
        target = next((item for item in re.findall(r"__doPostBack\('([^']+)'", html) if re.search(r"excel", item, re.I)), None)
        if target:
            excel = ("__EVENTTARGET", target)
    return {
        "action": urljoin(page_url, parser.action or page_url),
        "fields": parser.fields,
        "report_name": report_name,
        "report_value": report_value,
        "rotation_name": rotation_name,
        "rotations": rotations,
        "date_name": date_name,
        "show": show,
        "excel": excel,
    }


def _payload(form: dict[str, Any], *, day: date, rotation_value: str, button: tuple[str, str] | None) -> dict[str, str]:
    payload: dict[str, str] = {}
    for name, value in form["fields"]:
        payload[name] = value
    if form["report_name"]:
        payload[form["report_name"]] = form["report_value"]
    if form["rotation_name"]:
        payload[form["rotation_name"]] = rotation_value
    if form["date_name"]:
        payload[form["date_name"]] = format_jalali_padded(day)
    if button and button[0]:
        payload[button[0]] = button[1]
    payload.setdefault("__EVENTTARGET", "")
    payload.setdefault("__EVENTARGUMENT", "")
    return payload


def fetch_cellroom_shifts(
    opener: urllib.request.OpenerDirector,
    base: str,
    start: date,
    end: date,
    *,
    username: str | None = None,
    password: str | None = None,
) -> list[dict[str, Any]]:
    """Download گزارش کارکردی سلول‌ها for each rotation in the date window."""
    from .shift_report import parse_shift_html, parse_shift_xlsx

    page = f"{base}/ViewShiftReport.aspx"
    body, _meta = _read(opener, page)
    html = _decode_page(body)
    form = _parse_form(html, page)
    if form is None or not form["report_name"] or not form["date_name"]:
        raise RuntimeError("AriaORMS shift report form was not recognized")
    rotations = form["rotations"] or [("", "")]
    found: list[dict[str, Any]] = []
    day = start
    while day <= end:
        for index, (value, text) in enumerate(rotations):
            if form is None:
                body, _meta = _read(opener, page)
                form = _parse_form(_decode_page(body), page)
                if form is None:
                    break
            payload = _payload(form, day=day, rotation_value=value, button=form["show"])
            posted, meta = _read(opener, form["action"], urllib.parse.urlencode(payload).encode())
            parsed = None
            if posted[:2] == b"PK" or "excel" in meta.lower() or "spreadsheet" in meta.lower():
                try:
                    parsed = parse_shift_xlsx(posted, fallback_date=day, rotation=text, shift_index=index)
                except Exception:  # noqa: BLE001
                    parsed = None
                form = None
            else:
                page_html = _decode_page(posted)
                parsed = parse_shift_html(page_html, fallback_date=day, rotation=text, shift_index=index)
                form = _parse_form(page_html, page) or form
                if (parsed is None or not parsed.get("units")) and form and form.get("excel"):
                    excel_payload = _payload(form, day=day, rotation_value=value, button=form["excel"])
                    excel_body, excel_meta = _read(
                        opener, form["action"], urllib.parse.urlencode(excel_payload).encode()
                    )
                    if excel_body[:2] == b"PK":
                        parsed = parse_shift_xlsx(
                            excel_body, fallback_date=day, rotation=text, shift_index=index
                        )
                    elif excel_body[:1] in {b"<", b"\xef"}:
                        parsed = parse_shift_html(
                            _decode_page(excel_body),
                            fallback_date=day,
                            rotation=text,
                            shift_index=index,
                        )
                    form = None
                    logger.info("Shift excel %s %s (%s)", day, text, excel_meta[:80])
            if parsed and parsed.get("units"):
                found.append(parsed)
            elif username and password and form is None:
                try:
                    login(opener, base, username, password)
                except Exception:  # noqa: BLE001
                    logger.exception("AriaORMS re-login before the next shift failed")
        if day >= end:
            break
        day += timedelta(days=1)
    return found
