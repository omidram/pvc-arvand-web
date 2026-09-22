"""Capture README screenshots of the running PVC Arvand UI."""
from __future__ import annotations

import json
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "docs" / "screenshots"
OUT.mkdir(parents=True, exist_ok=True)
BASE = "http://127.0.0.1:3000"
API = "http://127.0.0.1:8010/api"


def login(page):
    page.goto(BASE + "/", wait_until="networkidle")
    page.wait_for_selector('input[type="password"], input[type="text"], input:not([type])')
    inputs = page.locator("input")
    # Username then password — Access-style form
    boxes = page.locator('input:visible')
    count = boxes.count()
    if count >= 2:
        boxes.nth(0).fill("admin")
        boxes.nth(1).fill("admin123")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_timeout(1500)


def shot(page, name: str):
    path = OUT / f"{name}.png"
    page.screenshot(path=str(path), full_page=False)
    print("saved", path.name, path.stat().st_size)


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 900})
        page = context.new_page()

        page.goto(BASE + "/", wait_until="networkidle")
        shot(page, "01-login")

        login(page)
        page.wait_for_timeout(1000)
        shot(page, "02-main-menu")

        for path, name in [
            ("/elements", "03-element-admin"),
            ("/elements/assembly", "04-assembly-data"),
            ("/voltage?form=readings", "05-voltage-readings"),
            ("/analyses", "06-analysis"),
            ("/inspections", "07-inspections"),
            ("/segregation", "08-segregation"),
            ("/overview", "09-overview"),
        ]:
            page.goto(BASE + path, wait_until="networkidle")
            page.wait_for_timeout(800)
            shot(page, name)

        browser.close()
    print("DONE", list(OUT.glob("*.png")))


if __name__ == "__main__":
    main()
