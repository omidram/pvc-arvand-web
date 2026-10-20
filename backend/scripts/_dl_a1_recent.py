"""Download one AriaORMS log sheet and print parse diagnostics."""
from __future__ import annotations

import os
import sys
import urllib.parse
import urllib.request
import http.cookiejar
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("ARIA_USER", "588955")
os.environ.setdefault("ARIA_PASS", "588955")

from app.plant_import import parse_voltage_excel  # noqa: E402

BASE = "http://192.168.20.12:8080"


def login(opener):
    data = urllib.parse.urlencode(
        {"username": os.environ["ARIA_USER"], "password": os.environ["ARIA_PASS"], "captcha": ""}
    ).encode()
    req = urllib.request.Request(f"{BASE}/ajax/logindebug.aspx", data=data)
    result = opener.open(req, timeout=40).read().decode("utf-8", "replace").strip()
    print("login", result[:80])
    if result.lower() != "true":
        raise SystemExit("login failed")


def main():
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    login(opener)
    log_id, start, end, name = 170, "1405-7-1", "1405-7-8", "A1"
    url = f"{BASE}/FileDownloader.aspx?logid={log_id}&StartDate={start}&EndDate={end}&action=logsheet"
    body = opener.open(url, timeout=180).read()
    out = BACKEND / "instance" / f"_a1_{start}_{end}.xlsx"
    out.write_bytes(body)
    print("bytes", len(body), "magic", body[:8], "saved", out)
    if body[:2] != b"PK":
        print(body[:500].decode("utf-8", "replace"))
        return
    parsed = parse_voltage_excel(body)
    print("error", parsed.get("error"))
    print("el", parsed.get("electrolyzer"), "dates", parsed.get("dates"), "cells", parsed.get("imported_cells"))
    slots = parsed.get("total_slots") or []
    print("slots", len(slots))
    for slot in slots[:6]:
        print(" ", slot)


if __name__ == "__main__":
    main()
