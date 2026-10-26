"""
Engineering calculations from the Uhde Administrator operating manual
and from Access VBA ``ModBerechnungen`` (the plant's working formulas).

Current-efficiency formulas below match Access ``Eta*Ber`` / ``VAnolytBer``
exactly. Standardized voltage follows Access ``UnBer``.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime as datetime_cls
from datetime import time as time_cls


@dataclass
class StandardizedVoltageResult:
    standardized_voltage: float
    inputs: dict


# Constants hard-coded in Access UnBer(): U0 = 2.42 V, standard 90 degC and 32 % NaOH.
UN_U0 = 2.42
UN_T_REF = 90.0
UN_C_REF = 32.0


def standardized_voltage(
    u_meas: float,
    current_density: float,
    reference_current_density: float,
    temp_meas: float,
    conc_meas: float,
    temp_correction: float,
    conc_correction: float,
    zero_voltage: float | None = None,  # ignored - Access always uses 2.42 V
    temp_ref: float | None = None,  # ignored - Access always uses 90 degC
    conc_ref: float | None = None,  # ignored - Access always uses 32 %
) -> StandardizedVoltageResult:
    """Access ``UnBer``:

        Un = 2.42 + (iRef / i) * (U - 2.42) - (90 - t) * tKorr + (32 - c) * cKorr

    - u_meas: measured cell voltage [V] (single element Ui, or electrolyzer U total / n)
    - current_density: i = I total / element area [kA/m2]
    - reference_current_density: iRef [kA/m2] of the chosen tblUnKorrekturfaktoren row
    - temp_meas: tm = (t anolyte + t catholyte) / 2 [degC]
    - conc_meas: Cc, catholyte NaOH concentration [% w/w]
    - temp_correction / conc_correction: tKorr [V/degC] / cKorr [V/%] of that row
    """
    if not current_density:
        raise ValueError("current_density must be non-zero")

    un = (
        UN_U0
        + (reference_current_density / current_density) * (u_meas - UN_U0)
        - (UN_T_REF - temp_meas) * temp_correction
        + (UN_C_REF - conc_meas) * conc_correction
    )
    return StandardizedVoltageResult(
        standardized_voltage=round(un, 4),
        inputs={
            "u_meas": u_meas,
            "current_density": current_density,
            "reference_current_density": reference_current_density,
            "zero_voltage": UN_U0,
            "temp_meas": temp_meas,
            "temp_ref": UN_T_REF,
            "conc_meas": conc_meas,
            "conc_ref": UN_C_REF,
            "temp_correction": temp_correction,
            "conc_correction": conc_correction,
        },
    )


@dataclass
class CurrentEfficiencyResult:
    eta_naclo3: float | None
    eta_hocl: float | None  # Access EtaNaOClBer (HOCl / NaOCl, same slot)
    eta_hcl: float | None
    eta_alkali: float | None
    eta_na2co3: float | None
    eta_o2: float | None
    eta_membrane: float | None
    v_anolyte: float | None
    notes: list[str]


def anolyte_flow_from_sulfate(
    v_pure_brine: float | None,
    c_na2so4_pb: float | None,
    c_na2so4_an: float | None,
) -> float | None:
    """Access ``VAnolytBer``: V' = V * (c_SO4_pb / c_SO4_an)."""
    if v_pure_brine is None or c_na2so4_pb is None or c_na2so4_an is None:
        return None
    if c_na2so4_an == 0:
        return None
    return v_pure_brine * (c_na2so4_pb / c_na2so4_an)


def current_efficiency(
    n_cells: int,
    current_ka: float,
    v_pure_brine: float | None = None,
    v_anolyte: float | None = None,
    c_naclo3_pb: float | None = None,
    c_naclo3_an: float | None = None,
    c_hocl_an: float | None = None,
    c_hcl_pb: float | None = None,
    c_hcl_an: float | None = None,
    c_naoh_pb: float | None = None,
    c_na2co3_pb: float | None = None,
    c_na2so4_pb: float | None = None,
    c_na2so4_an: float | None = None,
    y_o2: float | None = None,
    y_cl2: float | None = None,
    akf: float = 0.0,
    acidified: bool = False,
    clo_as_naclO: bool = False,
) -> CurrentEfficiencyResult:
    """Anodic-balance current efficiency — Access ``ModBerechnungen`` parity.

    Units match Access: flows in m³/h, concentrations in g/l (or %vol for gas),
    current in kA, ``n_cells`` = number of cells in the balance boundary.
    """
    notes: list[str] = []
    denom = n_cells * current_ka
    if not denom:
        raise ValueError("n_cells and current_ka must be non-zero")

    v = v_pure_brine
    v_p = v_anolyte
    if v_p is None:
        derived = anolyte_flow_from_sulfate(v, c_na2so4_pb, c_na2so4_an)
        if derived is not None:
            v_p = derived
            notes.append("v_anolyte derived from sulfate balance (Access VAnolytBer)")

    # Access EtaNaClO3Ber: ((c_an * V') - (c_pb * V)) / (n*i*0.662) * 100
    eta_naclo3 = None
    if v is not None and v_p is not None and c_naclo3_pb is not None and c_naclo3_an is not None:
        eta_naclo3 = ((c_naclo3_an * v_p) - (c_naclo3_pb * v)) / (0.662 * denom) * 100
    else:
        notes.append("eta_naclo3 skipped: needs pure-brine and anolyte flow + NaClO3 concentrations")

    # Access EtaNaOClBer — 0.98 for HOCl analysis, 1.38869 when ClO is analysed as NaOCl
    eta_hocl = None
    clo_factor = 1.38869 if clo_as_naclO else 0.98
    if v_p is not None and c_hocl_an is not None:
        eta_hocl = (c_hocl_an * v_p) / (clo_factor * denom) * 100
    else:
        notes.append("eta_hocl skipped: needs anolyte flow + HOCl/NaOCl concentration")

    # Access EtaHClBer — 0 when the plant is not acidified
    eta_hcl = None
    if acidified:
        if v is not None and v_p is not None and c_hcl_pb is not None and c_hcl_an is not None:
            eta_hcl = ((c_hcl_pb * v) - (c_hcl_an * v_p)) / (1.36 * denom) * 100
        else:
            notes.append("eta_hcl skipped: needs pure-brine and anolyte flow + HCl concentrations")
    else:
        eta_hcl = 0.0

    # Access EtaAlkaliBer / EtaNa2CO3Ber
    eta_alkali = None
    if v is not None and c_naoh_pb is not None:
        eta_alkali = (c_naoh_pb * v) / (1.4923 * denom) * 100
    else:
        notes.append("eta_alkali skipped: needs pure-brine flow + NaOH concentration")

    eta_na2co3 = None
    if v is not None and c_na2co3_pb is not None:
        eta_na2co3 = (c_na2co3_pb * v) / (1.978 * denom) * 100
    else:
        notes.append("eta_na2co3 skipped: needs pure-brine flow + Na2CO3 concentration")

    # Access EtaO2Ber — needs cell-gas O2/Cl2 and the chlorate/hypochlorite losses
    eta_o2 = None
    if y_o2 is not None and y_cl2 is not None and eta_naclo3 is not None and eta_hocl is not None:
        gas_den = y_cl2 + 2 * y_o2
        if gas_den != 0:
            eta_o2 = 2 * (y_o2 - 0.18 + akf) / gas_den * (100 - eta_naclo3 - eta_hocl)
        else:
            notes.append("eta_o2 skipped: YCl2 + 2*YO2 is zero")
    else:
        notes.append("eta_o2 skipped: needs Y_O2, Y_Cl2 and the NaClO3 / HOCl terms")

    # Access EtaMembraneBer = 100 - ηO2 - ηNaClO3 - ηNaOCl - ηHCl + ηNa2CO3 + ηAlkali
    # Access refuses the result when any term is Null; we do the same for the full formula.
    eta_membrane = None
    needed = [eta_o2, eta_naclo3, eta_hocl, eta_hcl, eta_na2co3, eta_alkali]
    if all(x is not None for x in needed):
        eta_membrane = (
            100.0
            - eta_o2  # type: ignore[operator]
            - eta_naclo3  # type: ignore[operator]
            - eta_hocl  # type: ignore[operator]
            - eta_hcl  # type: ignore[operator]
            + eta_na2co3  # type: ignore[operator]
            + eta_alkali  # type: ignore[operator]
        )
    else:
        notes.append(
            "eta_membrane skipped: Access needs ηO2, ηNaClO3, ηNaOCl, ηHCl, ηNa2CO3 and ηAlkali together"
        )

    def _r(x: float | None) -> float | None:
        return None if x is None else round(x, 3)

    return CurrentEfficiencyResult(
        eta_naclo3=_r(eta_naclo3),
        eta_hocl=_r(eta_hocl),
        eta_hcl=_r(eta_hcl),
        eta_alkali=_r(eta_alkali),
        eta_na2co3=_r(eta_na2co3),
        eta_o2=_r(eta_o2),
        eta_membrane=_r(eta_membrane),
        v_anolyte=_r(v_p),
        notes=notes,
    )


def _as_date(value):
    if value is None:
        return None
    if isinstance(value, datetime_cls):
        value = value.date()
    if isinstance(value, date_cls):
        if value.year < 1990 or value.year > 2045:
            return None
        return value
    return None


def days_on_line(commissioning_date, decommissioning_date, reference_today=None) -> int | None:
    start = _as_date(commissioning_date)
    if not start:
        return None
    end = _as_date(decommissioning_date) or reference_today or date_cls.today()
    return (end - start).days


# Lives assembled/commissioned on or after this day use commission + shutdown/startup times.
# Earlier Excel/imported lives use the last assembly date of that serial.
DOL_OPERATOR_ERA = date_cls(2026, 10, 26)
_PLANT_WIDE_SHUTDOWN = frozenset({"ca total plant", "total plant", "plant"})


def _as_datetime(value):
    if value is None:
        return None
    if isinstance(value, datetime_cls):
        return value.replace(tzinfo=None) if value.tzinfo else value
    if isinstance(value, date_cls):
        return datetime_cls.combine(value, time_cls.min)
    if isinstance(value, str):
        text = value.strip().replace("Z", "")
        if not text:
            return None
        try:
            return datetime_cls.fromisoformat(text)
        except ValueError:
            try:
                return datetime_cls.fromisoformat(text[:19])
            except ValueError:
                return None
    return None


def is_operator_era(assembly_date, commissioning_date, cutoff=None) -> bool:
    edge = cutoff or DOL_OPERATOR_ERA
    if not isinstance(edge, date_cls):
        edge = DOL_OPERATOR_ERA
    asm = _as_date(assembly_date)
    com = _as_date(commissioning_date)
    return bool((com and com >= edge) or (asm and asm >= edge))


def last_assembly_date(lives) -> object:
    dates = [_as_date(getattr(el, "assembly_date", None)) for el in lives or []]
    dates = [d for d in dates if d]
    return max(dates) if dates else None


def shutdowns_affecting(windows, electrolyzer: str | None) -> list[tuple]:
    """Shutdown (down, up) pairs that apply to this electrolyzer.

    Matches the cell name (A1), its train (Train1), and plant-wide rows.
    """
    from .plant_topology import format_electrolyzer_name, train_of

    if not windows:
        return []
    elo = format_electrolyzer_name(electrolyzer) if electrolyzer else ""
    train = train_of(elo) if elo else None
    matched: list[tuple] = []
    for item in windows:
        if isinstance(item, (tuple, list)):
            part = item[0] if len(item) > 0 else None
            down = item[1] if len(item) > 1 else None
            up = item[2] if len(item) > 2 else None
        else:
            part = getattr(item, "plant_part", None)
            down = getattr(item, "shutdown_time", None)
            up = getattr(item, "startup_time", None)
        if not down:
            continue
        raw = (part or "").strip()
        key = raw.lower().replace(" ", "")
        if raw.lower() in _PLANT_WIDE_SHUTDOWN or key in {"catotalplant", "totalplant"}:
            matched.append((down, up))
            continue
        if elo and format_electrolyzer_name(raw) == elo:
            matched.append((down, up))
            continue
        if train and key in {f"train{train}", train}:
            matched.append((down, up))
    return matched


def operating_dol_days(start, end, shutdowns=None) -> int | None:
    """Uptime days from start to end, subtracting shutdown_time→startup_time windows."""
    start_dt = _as_datetime(start)
    if not start_dt:
        return None
    end_dt = _as_datetime(end) or datetime_cls.now()
    if end_dt < start_dt:
        return 0
    events: list[tuple] = []
    for item in shutdowns or []:
        if isinstance(item, (tuple, list)):
            down, up = (list(item) + [None])[:2]
        else:
            down = getattr(item, "shutdown_time", None) or (item or {}).get("shutdown")
            up = getattr(item, "startup_time", None) or (item or {}).get("startup")
        down_dt = _as_datetime(down)
        if not down_dt:
            continue
        events.append((down_dt, _as_datetime(up)))
    events.sort(key=lambda pair: pair[0])
    uptime = 0.0
    cursor = start_dt
    running = True
    for down, up in events:
        if down >= end_dt:
            break
        if up and up <= start_dt:
            continue
        if down < start_dt:
            if up and up > start_dt:
                cursor = max(cursor, up)
                running = True
            else:
                running = False
            continue
        if running and down > cursor:
            uptime += (down - cursor).total_seconds()
        running = False
        if up is None or up >= end_dt:
            break
        if up > cursor:
            cursor = up
            running = True
    if running and end_dt > cursor:
        uptime += (end_dt - cursor).total_seconds()
    return int(uptime // 86400)


def installation_dol(
    assembly_date,
    commissioning_date,
    disassembly_date,
    decommissioning_date=None,
    reference_today=None,
    last_assembly=None,
    shutdowns=None,
    start_not_before=None,
) -> int | None:
    """Days on line for one installation.

    Excel / pre-cutoff lives: last assembly date → dismantle (or today).
    From the operator era onward: commission date minus shutdown/startup outages.
    """
    today = reference_today or date_cls.today()
    asm = _as_date(last_assembly) or _as_date(assembly_date)
    com = _as_date(commissioning_date)
    closed = _as_date(disassembly_date) or _as_date(decommissioning_date)
    clip = _as_date(start_not_before)

    if is_operator_era(asm, com):
        start = com or asm
        if not start:
            return None
        if clip and start < clip:
            start = clip
        if closed:
            end_dt = datetime_cls.combine(closed, time_cls(23, 59, 59))
        else:
            end_dt = datetime_cls.now() if reference_today is None else datetime_cls.combine(today, time_cls(23, 59, 59))
        return operating_dol_days(start, end_dt, shutdowns)

    start = asm
    if not start:
        return None
    if clip and start < clip:
        start = clip
    end = closed or today
    if end < start:
        return 0
    return (end - start).days


def serial_dol(lives, shutdowns=None, reference_today=None, start_not_before=None) -> int | None:
    """DOL for an anode/cathode/membrane: last assembly of all lives, or operator-era rules on the latest life."""
    rows = [el for el in (lives or []) if el is not None]
    if not rows:
        return None

    def _key(el):
        return (
            _as_date(el.assembly_date) or _as_date(el.commissioning_date) or date_cls.min,
            _as_date(el.commissioning_date) or date_cls.min,
            getattr(el, "id", 0) or 0,
        )

    latest = max(rows, key=_key)
    return installation_dol(
        latest.assembly_date,
        latest.commissioning_date,
        latest.disassembly_date,
        latest.decommissioning_date,
        reference_today,
        last_assembly=last_assembly_date(rows),
        shutdowns=shutdowns,
        start_not_before=start_not_before,
    )


def element_dol(el, shutdowns=None, last_assembly=None, reference_today=None, start_not_before=None) -> int | None:
    return installation_dol(
        getattr(el, "assembly_date", None),
        getattr(el, "commissioning_date", None),
        getattr(el, "disassembly_date", None),
        getattr(el, "decommissioning_date", None),
        reference_today,
        last_assembly=last_assembly,
        shutdowns=shutdowns,
        start_not_before=start_not_before,
    )
