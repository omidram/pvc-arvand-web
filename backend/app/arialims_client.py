"""HTTP client scaffold for AriaLims lab-analysis API.

Mirrors the role of ``ariaorms_client`` (voltage LogSheets), but for laboratory
samples that feed the Analysis module (anolyte, catholyte, pure brine, …).

Endpoint paths below are **placeholders**. Fill them when the AriaLims API
contract arrives; keep response mapping in ``arialims_sync.py``.
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

# ---------------------------------------------------------------------------
# Endpoint catalogue — update paths/query params once AriaLims docs arrive.
# Keys match AnalysisSample.analysis_type values used by the Access Analyse menu.
# ---------------------------------------------------------------------------
ANALYSIS_ENDPOINT_CATALOG: dict[str, dict[str, str]] = {
    "anolyte": {
        "path": "/api/v1/analyses/anolyte",  # TODO: confirm with AriaLims
        "description": "Anolyte lab results",
    },
    "catholyte": {
        "path": "/api/v1/analyses/catholyte",
        "description": "Catholyte / caustic lab results",
    },
    "pure_brine": {
        "path": "/api/v1/analyses/pure-brine",
        "description": "Pure brine (Reinstsole) results",
    },
    "chlorine_gas": {
        "path": "/api/v1/analyses/chlorine-gas",
        "description": "Chlorine gas analysis",
    },
    "hydrogen": {
        "path": "/api/v1/analyses/hydrogen",
        "description": "Hydrogen analysis",
    },
    "hcl": {
        "path": "/api/v1/analyses/hcl",
        "description": "HCl to anolyte / acidification",
    },
    "demin_water": {
        "path": "/api/v1/analyses/demin-water",
        "description": "Demineralized water",
    },
    "caustic_feed": {
        "path": "/api/v1/analyses/caustic-feed",
        "description": "Lean caustic feed",
    },
}

# Auth / health placeholders
AUTH_LOGIN_PATH = "/api/v1/auth/login"  # TODO
HEALTH_PATH = "/api/v1/health"  # TODO


@dataclass
class AriaLimsConfig:
    base_url: str
    username: str | None = None
    password: str | None = None
    api_token: str | None = None
    timeout_s: int = 60


class AriaLimsNotConfigured(RuntimeError):
    """Raised when base URL / credentials are missing."""


class AriaLimsContractPending(RuntimeError):
    """Raised until AriaLims publishes the real endpoint contract."""


def normalize_base_url(source_url: str | None) -> str:
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
    """Public list for Settings UI / API docs."""
    rows: list[dict[str, str]] = []
    for analysis_type, meta in ANALYSIS_ENDPOINT_CATALOG.items():
        rows.append(
            {
                "analysis_type": analysis_type,
                "path": meta["path"],
                "description": meta["description"],
                "status": "pending_contract",
            }
        )
    return rows


def _build_headers(cfg: AriaLimsConfig, *, json_body: bool = False) -> dict[str, str]:
    headers = {"Accept": "application/json", "User-Agent": "PVC-Arvand-AriaLims/1.0"}
    if json_body:
        headers["Content-Type"] = "application/json"
    token = (cfg.api_token or "").strip()
    if token:
        if token.lower().startswith("bearer "):
            headers["Authorization"] = token
        else:
            headers["Authorization"] = f"Bearer {token}"
    return headers


def _request(
    cfg: AriaLimsConfig,
    method: str,
    path: str,
    *,
    query: dict[str, Any] | None = None,
    body: dict[str, Any] | None = None,
) -> tuple[int, Any]:
    base = normalize_base_url(cfg.base_url)
    if not base:
        raise AriaLimsNotConfigured("AriaLims base_url is not set")
    url = base + (path if path.startswith("/") else f"/{path}")
    if query:
        url += "?" + urllib.parse.urlencode({k: v for k, v in query.items() if v is not None})
    data = None
    headers = _build_headers(cfg, json_body=body is not None)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    # Optional HTTP Basic when username/password set and no bearer token
    if cfg.username and cfg.password and "Authorization" not in headers:
        import base64

        raw = f"{cfg.username}:{cfg.password}".encode("utf-8")
        headers["Authorization"] = "Basic " + base64.b64encode(raw).decode("ascii")
    req = urllib.request.Request(url, data=data, headers=headers, method=method.upper())
    try:
        with urllib.request.urlopen(req, timeout=cfg.timeout_s) as resp:
            raw = resp.read()
            status = getattr(resp, "status", 200) or 200
    except urllib.error.HTTPError as exc:
        raw = exc.read() if exc.fp else b""
        status = exc.code
        logger.warning("AriaLims HTTP %s %s → %s", method, path, status)
    except urllib.error.URLError as exc:
        raise RuntimeError(f"AriaLims unreachable: {exc.reason}") from exc

    if not raw:
        return status, None
    try:
        return status, json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return status, raw.decode("utf-8", "replace")


def test_connection(cfg: AriaLimsConfig) -> dict[str, Any]:
    """Ping health (or base) to validate URL/credentials. Safe before contract is final."""
    base = normalize_base_url(cfg.base_url)
    if not base:
        raise AriaLimsNotConfigured("Set AriaLims base URL first")
    try:
        status, payload = _request(cfg, "GET", HEALTH_PATH)
        return {
            "ok": 200 <= status < 300,
            "status_code": status,
            "path_tried": HEALTH_PATH,
            "message": "Reachable" if 200 <= status < 300 else f"HTTP {status}",
            "payload_preview": str(payload)[:240] if payload is not None else None,
        }
    except Exception as exc:  # noqa: BLE001
        # Fall back to HEAD/GET on base URL so misconfigured health path still reports DNS/TCP.
        try:
            status, payload = _request(cfg, "GET", "/")
            return {
                "ok": False,
                "status_code": status,
                "path_tried": "/",
                "message": f"Health path failed ({exc}); base responded HTTP {status}",
                "payload_preview": str(payload)[:240] if payload is not None else None,
            }
        except Exception as exc2:  # noqa: BLE001
            return {
                "ok": False,
                "status_code": None,
                "path_tried": HEALTH_PATH,
                "message": str(exc2),
                "payload_preview": None,
            }


def fetch_analysis_page(
    cfg: AriaLimsConfig,
    analysis_type: str,
    *,
    date_from: date | datetime | None = None,
    date_to: date | datetime | None = None,
    cursor: str | None = None,
    page: int = 1,
    page_size: int = 200,
) -> dict[str, Any]:
    """Fetch one analysis type from AriaLims.

    Raises ``AriaLimsContractPending`` until paths are confirmed and parsing is implemented.
    """
    meta = ANALYSIS_ENDPOINT_CATALOG.get(analysis_type)
    if not meta:
        raise ValueError(f"Unsupported analysis_type '{analysis_type}'")

    # Silence unused-arg warnings until contract enables the real GET below.
    _ = (date_from, date_to, cursor, page, page_size)

    # Hard gate: do not hit production LIMS with guessed paths until contract is signed off.
    # After docs arrive: build query from date_from/date_to/cursor/page, call _request on meta["path"],
    # and return payload (or {"items": payload} when the API returns a bare list).
    raise AriaLimsContractPending(
        "AriaLims API contract is not configured yet. "
        f"Planned path for {analysis_type}: {meta['path']}. "
        "Update ANALYSIS_ENDPOINT_CATALOG + arialims_sync.normalize_sample when docs arrive."
    )
