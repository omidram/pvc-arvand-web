"""HTTP client for the AriaLIMS lab-results API.

One endpoint serves every lab analysis; it is queried per sampling point (SCID):

    GET {base}/api/AriaLIMS/results?SCIDs=242&StartTime=2026-10-01&EndTime=2026-10-08

    {"results": [{"analysisname": "Content active substance", "unitofmeaserment": "Wt %",
                  "scid": 242, "scno": "Activator (V-42501) ", "value": "1.32",
                  "samplingTime": "2026-10-04T10:30:00"}, ...]}

Which analysis type / scope a SCID belongs to is plant configuration
(``AriaLimsSamplingPoint``), handled in ``arialims_sync``.
"""
from __future__ import annotations

import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any
from urllib.parse import urlparse

logger = logging.getLogger("pvc_arvand.arialims")

RESULTS_PATH = "/api/AriaLIMS/results"

# Analysis types the Analysis module understands (Access Analyse menu).
ANALYSIS_TYPES: dict[str, str] = {
    "anolyte": "Anolyte lab results",
    "catholyte": "Catholyte / caustic lab results",
    "pure_brine": "Pure brine (Reinstsole) results",
    "chlorine_gas": "Chlorine gas analysis",
    "hydrogen": "Hydrogen analysis",
    "hcl": "HCl to anolyte / acidification",
    "demin_water": "Demineralized water",
    "caustic_feed": "Lean caustic feed",
}


@dataclass
class AriaLimsConfig:
    base_url: str
    username: str | None = None
    password: str | None = None
    api_token: str | None = None
    timeout_s: int = 60


class AriaLimsNotConfigured(RuntimeError):
    """Raised when the base URL is missing."""


def normalize_base_url(source_url: str | None) -> str:
    """Host root only: a pasted sample URL (with /api/AriaLIMS/results?...) is cut back."""
    raw = (source_url or "").strip()
    if not raw:
        return ""
    if "://" not in raw:
        raw = "http://" + raw
    parsed = urlparse(raw)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}".rstrip("/")
    return raw.rstrip("/")


def endpoint_catalog() -> list[dict[str, str]]:
    """Public description of the endpoint, shown in Settings."""
    return [
        {
            "analysis_type": "results",
            "path": f"{RESULTS_PATH}?SCIDs=<scid>&StartTime=<yyyy-mm-dd>&EndTime=<yyyy-mm-dd>",
            "description": "Lab results per sampling point (SCID)",
            "status": "ready",
        }
    ]


def _build_headers(cfg: AriaLimsConfig) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "PVC-Arvand-AriaLIMS/1.0"}
    token = (cfg.api_token or "").strip()
    if token:
        headers["Authorization"] = token if token.lower().startswith("bearer ") else f"Bearer {token}"
    elif cfg.username and cfg.password:
        import base64

        raw = f"{cfg.username}:{cfg.password}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    return headers


def _get(cfg: AriaLimsConfig, path: str, query: dict[str, Any] | None = None) -> tuple[int, Any]:
    base = normalize_base_url(cfg.base_url)
    if not base:
        raise AriaLimsNotConfigured("AriaLIMS base URL is not set")
    url = base + (path if path.startswith("/") else f"/{path}")
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    req = urllib.request.Request(url, headers=_build_headers(cfg), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
            raw = resp.read()
            status = getattr(resp, "status", 200) or 200
    except urllib.error.HTTPError as exc:
        raw = exc.read() if exc.fp else b""
        status = exc.code
        logger.warning("AriaLIMS HTTP GET %s -> %s", path, status)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AriaLIMS unreachable: {exc.reason}") from exc
    if not raw:
        return status, None
    text = raw.decode("utf-8-sig", "replace")
    try:
        return status, json.loads(text)
    except json.JSONDecodeError:
        return status, text


def extract_results(payload: Any) -> list[dict[str, Any]]:
    """``{"results": [...]}`` (or a bare list) → list of result rows."""
    if isinstance(payload, dict):
        items = payload.get("results")
        if items is None:
            items = payload.get("Results")
        if items is None:
            items = payload.get("data") or payload.get("items") or []
    else:
        items = payload
    return [row for row in items if isinstance(row, dict)] if isinstance(items, list) else []


def _as_day(value: date | datetime) -> str:
    return (value.date() if isinstance(value, datetime) else value).isoformat()


def fetch_results(
    cfg: AriaLimsConfig,
    scid: int,
    date_from: date | datetime,
    date_to: date | datetime,
) -> list[dict[str, Any]]:
    """Results of one sampling point between two dates."""
    status, payload = _get(
        cfg,
        RESULTS_PATH,
        {"SCIDs": int(scid), "StartTime": _as_day(date_from), "EndTime": _as_day(date_to)},
    )
    if not 200 <= status < 300:
        detail = payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False) if payload else ""
        raise RuntimeError(f"AriaLIMS HTTP {status} for SCID {scid}" + (f": {detail[:200]}" if detail else ""))
    return extract_results(payload)


def test_connection(cfg: AriaLimsConfig, probe_scid: int | None = None) -> dict[str, Any]:
    """Check the service answers. With a configured SCID the real results call is used."""
    base = normalize_base_url(cfg.base_url)
    if not base:
        raise AriaLimsNotConfigured("Set AriaLIMS base URL first")
    try:
        if probe_scid is not None:
            today = date.today()
            status, payload = _get(
                cfg,
                RESULTS_PATH,
                {"SCIDs": int(probe_scid), "StartTime": today.isoformat(), "EndTime": today.isoformat()},
            )
            ok = 200 <= status < 300
            count = len(extract_results(payload)) if ok else 0
            return {
                "ok": ok,
                "status_code": status,
                "path_tried": f"{RESULTS_PATH}?SCIDs={probe_scid}",
                "message": f"Results endpoint reachable (SCID {probe_scid}, {count} row(s) today)" if ok else f"HTTP {status}",
                "payload_preview": str(payload)[:240] if payload is not None else None,
            }
        status, payload = _get(cfg, "/")
        return {
            "ok": True,
            "status_code": status,
            "path_tried": "/",
            "message": f"Server reachable (HTTP {status}). Add a sampling point to test the results endpoint.",
            "payload_preview": str(payload)[:240] if payload is not None else None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False,
            "status_code": None,
            "path_tried": RESULTS_PATH,
            "message": str(exc),
            "payload_preview": None,
        }
