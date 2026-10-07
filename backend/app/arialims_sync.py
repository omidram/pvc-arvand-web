"""AriaLims → analysis_samples sync (scaffold).

When AriaLims API docs arrive:
1. Confirm paths in ``arialims_client.ANALYSIS_ENDPOINT_CATALOG``.
2. Implement ``normalize_sample`` for the real JSON shape.
3. Remove the ``AriaLimsContractPending`` gate in ``fetch_analysis_page``.
4. Enable scheduler (mirror voltage_sync_scheduler) if daily pull is required.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

from sqlalchemy.orm import Session

from . import models
from .arialims_client import (
    ANALYSIS_ENDPOINT_CATALOG,
    AriaLimsConfig,
    AriaLimsContractPending,
    AriaLimsNotConfigured,
    endpoint_catalog,
    fetch_analysis_page,
    normalize_base_url,
    test_connection,
)

logger = logging.getLogger("pvc_arvand.arialims")

ProgressCb = Callable[[int, int], None] | None

# Access Analyse scopes we may receive from LIMS.
VALID_SCOPES = {"element", "group", "sub_plant", "electrolyzer", "total_plant"}


def default_settings() -> models.AriaLimsSyncSettings:
    return models.AriaLimsSyncSettings(
        enabled=False,
        base_url="",
        daily_time="01:00",
        lookback_days=7,
        analysis_types=",".join(ANALYSIS_ENDPOINT_CATALOG.keys()),
    )


def get_or_create_settings(db: Session) -> models.AriaLimsSyncSettings:
    row = db.query(models.AriaLimsSyncSettings).first()
    if row:
        return row
    row = default_settings()
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def config_from_settings(row: models.AriaLimsSyncSettings) -> AriaLimsConfig:
    return AriaLimsConfig(
        base_url=normalize_base_url(row.base_url) or "",
        username=row.username,
        password=row.password,
        api_token=row.api_token,
    )


def selected_analysis_types(row: models.AriaLimsSyncSettings) -> list[str]:
    raw = (row.analysis_types or "").strip()
    if not raw:
        return list(ANALYSIS_ENDPOINT_CATALOG.keys())
    wanted = [p.strip() for p in raw.replace(";", ",").split(",") if p.strip()]
    return [t for t in wanted if t in ANALYSIS_ENDPOINT_CATALOG]


def date_window(*, end: date | None = None, lookback_days: int = 7, include_today: bool = True) -> tuple[date, date]:
    end_day = end or date.today()
    if not include_today:
        end_day = end_day - timedelta(days=1)
    days = max(1, int(lookback_days or 1))
    start_day = end_day - timedelta(days=days - 1)
    return start_day, end_day


def normalize_sample(raw: dict[str, Any], *, analysis_type: str) -> dict[str, Any] | None:
    """Map one AriaLims JSON row → fields for ``AnalysisSample``.

    Placeholder tolerant mapping — adjust field names when the real API arrives.
    Expected output keys: analysis_type, scope, electrolyzer, position, group_nr,
    sub_plant, date (ISO), time, parameters (dict).
    """
    if not isinstance(raw, dict):
        return None
    # Common aliases we may see from LIMS / Excel-style exports
    scope = (
        raw.get("scope")
        or raw.get("Scope")
        or raw.get("level")
        or "electrolyzer"
    )
    scope = str(scope).strip().lower().replace(" ", "_")
    if scope in ("plant", "gesamtanlage", "total"):
        scope = "total_plant"
    if scope in ("train", "teilanlage", "subplant"):
        scope = "sub_plant"
    if scope not in VALID_SCOPES:
        scope = "electrolyzer"

    dt_raw = raw.get("date") or raw.get("Date") or raw.get("samplingDate") or raw.get("SamplingTime")
    time_raw = raw.get("time") or raw.get("Time") or raw.get("samplingTime")
    date_iso: str | None = None
    if isinstance(dt_raw, datetime):
        date_iso = dt_raw.date().isoformat()
        if not time_raw:
            time_raw = dt_raw.strftime("%H:%M")
    elif isinstance(dt_raw, date):
        date_iso = dt_raw.isoformat()
    elif isinstance(dt_raw, str) and dt_raw.strip():
        text = dt_raw.strip().replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
            date_iso = parsed.date().isoformat()
            if not time_raw and "T" in text:
                time_raw = parsed.strftime("%H:%M")
        except ValueError:
            date_iso = text[:10]

    params = raw.get("parameters") or raw.get("Parameters") or raw.get("results") or {}
    if not isinstance(params, dict):
        params = {}
    # Flatten numeric top-level analyte keys into parameters
    skip = {
        "date", "Date", "time", "Time", "scope", "Scope", "level",
        "electrolyzer", "Electrolyzer", "position", "Position",
        "group", "group_nr", "Group", "sub_plant", "Train", "parameters",
        "results", "id", "Id", "analysis_type", "type",
    }
    for key, value in raw.items():
        if key in skip:
            continue
        if isinstance(value, (int, float, str)) and value != "":
            params.setdefault(key, value)

    return {
        "analysis_type": analysis_type,
        "scope": scope,
        "electrolyzer": raw.get("electrolyzer") or raw.get("Electrolyzer") or raw.get("unit"),
        "position": raw.get("position") or raw.get("Position"),
        "group_nr": raw.get("group_nr") or raw.get("group") or raw.get("Group"),
        "sub_plant": raw.get("sub_plant") or raw.get("train") or raw.get("Train"),
        "date": date_iso,
        "time": str(time_raw).strip() if time_raw else None,
        "parameters": params,
        "external_id": raw.get("id") or raw.get("sampleId") or raw.get("SampleId"),
    }


def upsert_samples(db: Session, samples: list[dict[str, Any]]) -> int:
    """Insert normalized samples. Dedup by type+scope+date+time+electrolyzer+position when possible."""
    created = 0
    for sample in samples:
        if not sample:
            continue
        dt = None
        if sample.get("date"):
            try:
                dt = datetime.fromisoformat(str(sample["date"])[:10])
            except ValueError:
                dt = None
        q = db.query(models.AnalysisSample).filter(
            models.AnalysisSample.analysis_type == sample["analysis_type"],
            models.AnalysisSample.scope == sample.get("scope") or "electrolyzer",
            models.AnalysisSample.date == dt,
            models.AnalysisSample.time == sample.get("time"),
            models.AnalysisSample.electrolyzer == sample.get("electrolyzer"),
            models.AnalysisSample.position == sample.get("position"),
        )
        existing = q.first()
        if existing:
            existing.parameters = sample.get("parameters") or existing.parameters or {}
            existing.group_nr = sample.get("group_nr") or existing.group_nr
            existing.sub_plant = sample.get("sub_plant") or existing.sub_plant
            continue
        db.add(
            models.AnalysisSample(
                analysis_type=sample["analysis_type"],
                scope=sample.get("scope") or "electrolyzer",
                electrolyzer=sample.get("electrolyzer"),
                position=sample.get("position"),
                group_nr=sample.get("group_nr"),
                sub_plant=sample.get("sub_plant"),
                date=dt,
                time=sample.get("time"),
                parameters=sample.get("parameters") or {},
            )
        )
        created += 1
    db.commit()
    return created


def pull_from_arialims(
    db: Session,
    row: models.AriaLimsSyncSettings | None = None,
    *,
    include_today: bool = True,
    progress: ProgressCb = None,
) -> dict[str, Any]:
    """Orchestrate a pull. Returns structured status; does not raise for pending contract."""
    row = row or get_or_create_settings(db)
    cfg = config_from_settings(row)
    types = selected_analysis_types(row)
    start, end = date_window(lookback_days=row.lookback_days or 7, include_today=include_today)

    result: dict[str, Any] = {
        "ok": False,
        "mode": "api",
        "files_scanned": 0,
        "files_applied": 0,
        "rows_upserted": 0,
        "message": "",
        "details": [],
        "catalog": endpoint_catalog(),
        "date_from": start.isoformat(),
        "date_to": end.isoformat(),
        "contract_ready": False,
    }

    if not cfg.base_url:
        result["message"] = "AriaLims base URL is not configured (Settings → AriaLims Sync)."
        _mark_run(db, row, status="error", message=result["message"])
        return result

    total = max(len(types), 1)
    if progress:
        progress(0, total)

    try:
        # Prove wiring by attempting the first type; expect ContractPending until docs arrive.
        for idx, analysis_type in enumerate(types, start=1):
            try:
                payload = fetch_analysis_page(
                    cfg,
                    analysis_type,
                    date_from=start,
                    date_to=end,
                    cursor=row.sync_cursor,
                )
            except AriaLimsContractPending as pending:
                result["message"] = str(pending)
                result["details"].append({"analysis_type": analysis_type, "status": "pending_contract"})
                _mark_run(db, row, status="pending", message=result["message"][:480])
                if progress:
                    progress(total, total)
                return result
            except AriaLimsNotConfigured as exc:
                result["message"] = str(exc)
                _mark_run(db, row, status="error", message=result["message"][:480])
                return result

            items = []
            if isinstance(payload, dict):
                items = payload.get("items") or payload.get("data") or payload.get("results") or []
            elif isinstance(payload, list):
                items = payload
            normalized = [n for n in (normalize_sample(item, analysis_type=analysis_type) for item in items) if n]
            upserted = upsert_samples(db, normalized)
            result["rows_upserted"] += upserted
            result["details"].append(
                {"analysis_type": analysis_type, "status": "ok", "received": len(items), "upserted": upserted}
            )
            if progress:
                progress(idx, total)

        result["ok"] = True
        result["contract_ready"] = True
        result["message"] = f"Upserted {result['rows_upserted']} analysis sample(s) from AriaLims."
        _mark_run(db, row, status="success", message=result["message"][:480])
        return result
    except Exception as exc:  # noqa: BLE001
        logger.exception("AriaLims pull failed")
        result["message"] = str(exc)
        _mark_run(db, row, status="error", message=result["message"][:480])
        return result


def _mark_run(db: Session, row: models.AriaLimsSyncSettings, *, status: str, message: str) -> None:
    row.last_run_at = datetime.now(timezone.utc).replace(tzinfo=None)
    row.last_run_status = status
    row.last_run_message = message
    db.commit()


def ping(row: models.AriaLimsSyncSettings) -> dict[str, Any]:
    return test_connection(config_from_settings(row))


def apply_manual_payload(db: Session, payload: dict[str, Any] | list[Any], *, analysis_type: str) -> dict[str, Any]:
    """Dev helper: ingest a pasted JSON payload shaped like the future AriaLims response."""
    if analysis_type not in ANALYSIS_ENDPOINT_CATALOG:
        raise ValueError(f"Unsupported analysis_type '{analysis_type}'")
    items: list[Any]
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict):
        items = payload.get("items") or payload.get("data") or payload.get("results") or [payload]
    else:
        raise ValueError("JSON must be an object or array")
    normalized = [n for n in (normalize_sample(item, analysis_type=analysis_type) for item in items if isinstance(item, dict)) if n]
    upserted = upsert_samples(db, normalized)
    return {"ok": True, "received": len(items), "upserted": upserted, "analysis_type": analysis_type}
