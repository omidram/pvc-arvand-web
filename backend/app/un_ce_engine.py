"""Standardized voltage (Un) and current efficiency (CE) engine.

This module re-implements, query for query, what the original Uhde Access
"Administrator" database does behind the *Standardized Voltage* and *Current
Efficiency* forms (see ``backend/scripts/_vba_dump`` for the exported queries and
the ``Modul1`` VBA module).

Access object  ->  function here
------------------------------------------------------------------------------
UnBer / TempKorrElement / SPCBer ........ ``unber`` / ``ti_element`` / ``spc``
VAnolytBer, Eta*Ber ..................... ``ce_balance`` (one pure function)
qryUnElektrolyseur(2/e/en) .............. ``un_electrolyzer_rows``
qryUnGesamtanlage / Teilanlage (+2) ...... ``un_plant_rows`` / ``un_train_rows``
UnGruppen / ListGr2 / qryUnGruppe2 ....... ``un_group_rows``
qryUnElement(e) / qryUnElement(e)2 ....... ``un_element_rows``
qryCE* (anodic balance) .................. ``ce_*_rows``
qryCE*NaOH (entered CE) .................. ``ce_naoh_rows``
qrySPC* .................................. ``spc_rows``

Settings (tblGewDaten) live in :class:`app.models.UnCeSettings`; acidification
stays on :class:`app.models.PlantSettings`.

Deliberate, documented differences to Access (all of them only remove artefacts):
* date bounds are inclusive on both sides (Access NormElek-based queries use ``>``/``<``
  and would silently drop the first/last day);
* rows whose Access function result is the ``-1`` "Null" sentinel are dropped instead of
  being shown / averaged as -1;
* element Un with the element temperature correction switched on: Access joins ``Um`` on
  date only and returns one row per slot Um; we return the row of the reading's own slot
  (verified to be one of the Access rows);
* group Un (ListGr / Norm(Um)GR) reproduces the Access weighting: every reading counts once
  per complete slot of its electrolyzer and day (the ``Um`` date-only join);
* CE rows with missing Cl2/O2 are skipped for group / element too (Access would add a bogus -1).
"""
from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Iterable, Iterator

from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models
from .plant_topology import format_electrolyzer_name, norm_pos, train_of

# Hard-coded constants of Access UnBer(): U0 = 2.42 V, reference 90 degC and 32 % NaOH.
U0 = 2.42
T_REF = 90.0
C_REF = 32.0

# Faraday-based divisors of the Eta*Ber functions (g/l * m3/h per kA per cell).
F_NACLO3 = 0.662
F_NAOCL_NACLO = 1.38869
F_NAOCL_HOCL = 0.98
F_HCL = 1.36
F_ALKALI = 1.4923
F_NA2CO3 = 1.978
O2_BACKGROUND = 0.18


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------


@dataclass
class Cfg:
    iref: float = 6.0
    tkorr: float = 0.02
    ckorr: float = 0.04
    area: float = 2.72
    umin: float = 0.2
    akf: float = 0.0
    clo_analysis: int = 2
    acidified: bool = True
    temp_corr_element: bool = False

    def as_dict(self) -> dict:
        return {
            "iref": self.iref,
            "tkorr": self.tkorr,
            "ckorr": self.ckorr,
            "area_m2": self.area,
            "umin": self.umin,
            "anodic_correction": self.akf,
            "clo_analysis": self.clo_analysis,
            "acidified": self.acidified,
            "temp_correction_element": 1 if self.temp_corr_element else 2,
        }


def load_cfg(db: Session) -> Cfg:
    cfg = Cfg()
    plant = db.query(models.PlantSettings).first()
    row = db.query(models.UnCeSettings).first()
    if plant is not None:
        cfg.acidified = bool(plant.acidified)
        if plant.reference_current_density:
            cfg.iref = float(plant.reference_current_density)
    if row is not None:
        cfg.iref = float(row.iref if row.iref is not None else cfg.iref)
        cfg.area = float(row.area_m2 if row.area_m2 else cfg.area)
        cfg.umin = float(row.umin if row.umin is not None else cfg.umin)
        cfg.akf = float(row.anodic_correction or 0.0)
        cfg.clo_analysis = int(row.clo_analysis or 2)
        cfg.temp_corr_element = int(row.temp_correction_element or 2) == 1
    factors = db.query(models.CorrectionFactor).all()
    best = None
    for factor in factors:
        if factor.reference_current_density is None:
            continue
        diff = abs(float(factor.reference_current_density) - cfg.iref)
        if best is None or diff < best[0]:
            best = (diff, factor)
    if best is not None:
        cfg.tkorr = float(best[1].temp_correction or 0.0)
        cfg.ckorr = float(best[1].conc_correction or 0.0)
    return cfg


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _f(value) -> float | None:
    if value is None or value == "":
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(out) or math.isinf(out):
        return None
    return out


def day_of(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip().replace("T", " ")
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def parse_day(value) -> date | None:
    return day_of(value)


def tkey(value) -> str:
    """Normalise a time string so 06:00, 6:00 and 06:00:00 hit the same slot."""
    text = ("" if value is None else str(value)).strip()
    if not text:
        return ""
    if "T" in text:
        text = text.split("T", 1)[1]
    elif " " in text and ":" in text.split(" ", 1)[1]:
        text = text.split(" ", 1)[1]
    parts = text.split(":")
    try:
        hour = int(float(parts[0]))
        minute = int(float(parts[1])) if len(parts) > 1 and parts[1] != "" else 0
    except ValueError:
        return text
    return f"{hour:02d}:{minute:02d}"


def ekey(name) -> str:
    """Canonical electrolyzer key (A1 == 1A)."""
    raw = ("" if name is None else str(name)).strip()
    if not raw:
        return ""
    return format_electrolyzer_name(raw) or raw.upper()


def pkey(pos) -> str:
    return norm_pos(pos)


def gkey(group) -> str:
    text = ("" if group is None else str(group)).strip()
    if not text:
        return ""
    try:
        number = float(text)
        if number == int(number):
            return str(int(number))
    except ValueError:
        pass
    return text


def el_aliases(keys: Iterable[str]) -> list[str]:
    out: set[str] = set()
    for key in keys:
        raw = (key or "").strip().upper()
        if not raw:
            continue
        out.add(raw)
        letters = "".join(c for c in raw if c.isalpha())
        digits = "".join(c for c in raw if c.isdigit())
        if letters and digits:
            out.add(f"{letters}{digits}")
            out.add(f"{digits}{letters}")
    return sorted(out)


def iso(d: date | None) -> str | None:
    return d.isoformat() if d else None


def _dt(d: date) -> datetime:
    return datetime(d.year, d.month, d.day)


def default_window(d0: date | None, d1: date | None) -> tuple[date, date]:
    start = d0 or date(1990, 1, 1)
    end = d1 or (date.today() + timedelta(days=1))
    if end < start:
        start, end = end, start
    return start, end


def _r(value: float | None, digits: int = 5) -> float | None:
    if value is None:
        return None
    return round(value, digits)


def avg(values: Iterable[float | None]) -> float | None:
    vals = [v for v in values if v is not None]
    if not vals:
        return None
    return sum(vals) / len(vals)


def wavg(pairs: Iterable[tuple[float | None, float]]) -> float | None:
    num = 0.0
    den = 0.0
    for value, weight in pairs:
        if value is None:
            continue
        num += value * weight
        den += weight
    return num / den if den else None


# ---------------------------------------------------------------------------
# Access formulas (Modul1)
# ---------------------------------------------------------------------------


def unber(u, i, t, c, cfg: Cfg) -> float | None:
    """Access ``UnBer``: 2.42 + (iRef/i)*(U-2.42) - (90-t)*tKorr + (32-c)*cKorr."""
    if u is None or i is None or t is None or c is None or not i:
        return None
    return U0 + (cfg.iref / i) * (u - U0) - (T_REF - t) * cfg.tkorr + (C_REF - c) * cfg.ckorr


def ti_element(tm, um, ui, cfg: Cfg) -> float | None:
    """Access ``TempKorrElement``: tm - (Um - Ui)*30 when switched on, else tm."""
    if tm is None or um is None or ui is None:
        return None
    return tm - (um - ui) * 30 if cfg.temp_corr_element else tm


def spc(un, ce) -> float | None:
    """Access ``SPCBer``: specific energy [kWh/t NaOH] = Un*100000/(1.4923*CE)."""
    if un is None or ce is None or not ce:
        return None
    return un * 100000 / (F_ALKALI * ce)


def v_anolyte(v_pb, so4_pb, so4_an) -> float | None:
    """Access ``VAnolytBer``: V_anolyte = V_pb * c(SO4, pb) / c(SO4, an)."""
    if v_pb is None or so4_pb is None or so4_an is None or not so4_an:
        return None
    return v_pb * (so4_pb / so4_an)


def ce_balance(cfg: Cfg, *, n, i, pb: dict, an: dict, cl: dict) -> dict | None:
    """Anodic-balance CE of one (analysis x normalisation) combination.

    ``pb`` flow / naclo3 / so4 / naoh / na2co3 / hcl, ``an`` naclo3 / so4 / naocl / hcl,
    ``cl`` cl2 / o2. Returns ``None`` whenever Access would produce the -1 sentinel (any
    missing input) or a division by zero.
    """
    if n is None or i is None or not n or not i:
        return None
    flow = pb.get("flow")
    v_an = v_anolyte(flow, pb.get("so4"), an.get("so4"))
    if v_an is None:
        return None
    y_cl2 = cl.get("cl2")
    y_o2 = cl.get("o2")
    if y_cl2 is None or y_o2 is None:
        return None
    denom = n * i

    if an.get("naclo3") is None or pb.get("naclo3") is None:
        return None
    mu_naclo3 = ((an["naclo3"] * v_an) - (pb["naclo3"] * flow)) / (denom * F_NACLO3) * 100

    if an.get("naocl") is None:
        return None
    clo_factor = F_NAOCL_NACLO if cfg.clo_analysis == 1 else F_NAOCL_HOCL
    mu_naocl = (an["naocl"] * v_an) / (denom * clo_factor) * 100

    if cfg.acidified:
        if pb.get("hcl") is None or an.get("hcl") is None:
            return None
        mu_hcl = ((pb["hcl"] * flow) - (an["hcl"] * v_an)) / (denom * F_HCL) * 100
    else:
        mu_hcl = 0.0

    if pb.get("naoh") is None:
        return None
    mu_alkali = (pb["naoh"] * flow) / (denom * F_ALKALI) * 100
    if pb.get("na2co3") is None:
        return None
    mu_na2co3 = (pb["na2co3"] * flow) / (denom * F_NA2CO3) * 100

    gas = y_cl2 + 2 * y_o2
    if not gas:
        return None
    mu_o2 = 2 * (y_o2 - O2_BACKGROUND + cfg.akf) / gas * (100 - mu_naclo3 - mu_naocl)
    mu_naoh = 100 - mu_o2 - mu_naclo3 - mu_naocl - mu_hcl + mu_na2co3 + mu_alkali
    return {
        "v_anolyte": v_an,
        "conc_cl2": y_cl2,
        "conc_o2": y_o2,
        "mu_naclo3": mu_naclo3,
        "mu_naocl": mu_naocl,
        "mu_hcl": mu_hcl,
        "mu_o2": mu_o2,
        "mu_alkali": mu_alkali,
        "mu_na2co3": mu_na2co3,
        "mu_naoh": mu_naoh,
    }


# ---------------------------------------------------------------------------
# Plant topology (trains)
# ---------------------------------------------------------------------------


def train_map(db: Session) -> dict[str, str]:
    """electrolyzer key -> train id. Cell-room names carry the train in the name; legacy
    names fall back to the arrangement table."""
    out: dict[str, str] = {}
    for arr in db.query(models.ElectrolyzerArrangement).all():
        key = ekey(arr.name)
        sub = (arr.sub_plant or "").strip()
        if key and sub:
            out.setdefault(key, sub)
    return out


def train_of_key(key: str, tmap: dict[str, str]) -> str | None:
    return train_of(key) or tmap.get(key)


# ---------------------------------------------------------------------------
# Normalisations + readings
# ---------------------------------------------------------------------------


@dataclass
class Norm:
    id: int
    nr: int | None
    el: str
    day: date
    time: str
    current: float | None
    cc: float | None
    t_an: float | None
    t_ka: float | None
    uo: float | None
    ug: float | None
    n: int | None
    stats: tuple[int, float] | None = field(default=None)  # (count, sum Ui>Umin)

    @property
    def complete(self) -> bool:
        return None not in (self.current, self.cc, self.t_an, self.t_ka)

    def tm(self) -> float | None:
        if self.t_an is None or self.t_ka is None:
            return None
        return (self.t_an + self.t_ka) / 2

    def i_dens(self, cfg: Cfg) -> float | None:
        return None if self.current is None else self.current / cfg.area

    def um_table1(self) -> float | None:
        """NormElek: Um = U Gesamt / Elementzahl."""
        if self.ug is None or not self.n:
            return None
        return self.ug / self.n

    def um_table2(self) -> float | None:
        """Normierung + qrySummeUElemente: mean of the element readings above Umin."""
        if not self.stats or not self.stats[0]:
            return None
        return self.stats[1] / self.stats[0]


def load_norms(db: Session, d0: date, d1: date, els: set[str] | None = None) -> list[Norm]:
    q = db.query(models.ElectrolyzerNormalization).filter(
        models.ElectrolyzerNormalization.date >= _dt(d0),
        models.ElectrolyzerNormalization.date < _dt(d1 + timedelta(days=1)),
    )
    out: list[Norm] = []
    for row in q.all():
        day = day_of(row.date)
        key = ekey(row.electrolyzer)
        if day is None or not key:
            continue
        if els is not None and key not in els:
            continue
        cc = _f(row.catholyte_conc)
        if cc is None:
            cc = _f(row.reference_current_density)  # legacy Access "Cc"
        out.append(
            Norm(
                id=row.id,
                nr=row.normalization_nr,
                el=key,
                day=day,
                time=tkey(row.time),
                current=_f(row.total_current),
                cc=cc,
                t_an=_f(row.anolyte_temp),
                t_ka=_f(row.catholyte_temp),
                uo=_f(row.zero_voltage),
                ug=_f(row.total_voltage),
                n=int(row.element_count) if row.element_count else None,
            )
        )
    out.sort(key=lambda n: (n.el, n.day, n.time))
    return out


class NormIndex:
    def __init__(self, norms: list[Norm]):
        self.by_slot: dict[tuple[str, date, str], Norm] = {}
        self.by_nr: dict[int, Norm] = {}
        for norm in norms:
            self.by_slot[(norm.el, norm.day, norm.time)] = norm
            if norm.nr is not None:
                self.by_nr[norm.nr] = norm

    def find(self, el: str, day: date | None, time: str, nr) -> Norm | None:
        if nr is not None and nr in self.by_nr:
            return self.by_nr[nr]
        if day is None:
            return None
        return self.by_slot.get((el, day, time))


def attach_stats(db: Session, cfg: Cfg, norms: list[Norm], d0: date, d1: date, els: set[str] | None) -> None:
    """Fill ``Norm.stats`` (count / sum of Ui > Umin) for the slot's element readings."""
    if not norms:
        return
    R = models.VoltageReading
    q = db.query(R.electrolyzer, R.date, R.time, func.count(R.voltage), func.sum(R.voltage)).filter(
        R.voltage > cfg.umin,
        R.date >= _dt(d0),
        R.date < _dt(d1 + timedelta(days=1)),
    )
    if els:
        q = q.filter(func.upper(R.electrolyzer).in_(el_aliases(els)))
    slot: dict[tuple[str, date, str], list[float]] = defaultdict(lambda: [0, 0.0])
    for raw_el, raw_date, raw_time, cnt, total in q.group_by(R.electrolyzer, R.date, R.time).all():
        key = (ekey(raw_el), day_of(raw_date), tkey(raw_time))
        if key[1] is None or not cnt:
            continue
        slot[key][0] += int(cnt)
        slot[key][1] += float(total or 0.0)

    by_nr: dict[int, tuple[int, float]] = {}
    nrs = [n.nr for n in norms if n.nr is not None]
    for start in range(0, len(nrs), 500):
        chunk = nrs[start : start + 500]
        for nr, cnt, total in (
            db.query(R.normalization_nr, func.count(R.voltage), func.sum(R.voltage))
            .filter(R.normalization_nr.in_(chunk), R.voltage > cfg.umin)
            .group_by(R.normalization_nr)
            .all()
        ):
            if cnt:
                by_nr[int(nr)] = (int(cnt), float(total or 0.0))

    for norm in norms:
        if norm.nr is not None and norm.nr in by_nr:
            norm.stats = by_nr[norm.nr]
        else:
            hit = slot.get((norm.el, norm.day, norm.time))
            if hit and hit[0]:
                norm.stats = (hit[0], hit[1])


def stream_readings(db: Session, cfg: Cfg, d0: date, d1: date, els: set[str] | None):
    """Yield (electrolyzer key, position key, day, time, Ui, normalization_nr) with Ui > Umin."""
    R = models.VoltageReading
    q = db.query(R.electrolyzer, R.position, R.date, R.time, R.voltage, R.normalization_nr).filter(
        R.voltage > cfg.umin,
        R.date >= _dt(d0),
        R.date < _dt(d1 + timedelta(days=1)),
    )
    if els:
        q = q.filter(func.upper(R.electrolyzer).in_(el_aliases(els)))
    for raw_el, pos, raw_date, raw_time, ui, nr in q.yield_per(5000):
        yield ekey(raw_el), pkey(pos), day_of(raw_date), tkey(raw_time), float(ui), nr


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


def col(key: str, header: str, align: str = "right") -> dict:
    return {"key": key, "header": header, "align": align}


@dataclass
class Result:
    columns: list[dict]
    rows: list[dict]
    value_key: str
    value_label: str
    series_key: str | None = None
    note: str = ""
    truncated: bool = False
    total: int | None = None

    def to_dict(self, cfg: Cfg) -> dict:
        chart = []
        for row in self.rows:
            value = row.get(self.value_key)
            if value is None or row.get("date") is None:
                continue
            chart.append(
                {
                    "x": row["date"],
                    "series": str(row.get(self.series_key)) if self.series_key and row.get(self.series_key) is not None else self.value_label,
                    "value": value,
                }
            )
        return {
            "columns": self.columns,
            "rows": self.rows,
            "chart": chart,
            "value_key": self.value_key,
            "value_label": self.value_label,
            "note": self.note,
            "truncated": self.truncated,
            "total": self.total if self.total is not None else len(self.rows),
            "settings": cfg.as_dict(),
        }


# ---------------------------------------------------------------------------
# Standardized voltage (Un)
# ---------------------------------------------------------------------------

UN_SLOT_COLUMNS = [
    col("electrolyzer", "Electrolyzer", "left"),
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("current", "I total [kA]"),
    col("i", "i [kA/m²]"),
    col("cc", "Cc [% NaOH]"),
    col("t_an", "t An [°C]"),
    col("t_ka", "t Ka [°C]"),
    col("tm", "tm [°C]"),
    col("uo", "Uo [V]"),
    col("um", "Um [V]"),
    col("un", "Un [V]"),
    col("iref", "iRef"),
]


def _slot_row(norm: Norm, cfg: Cfg, um: float | None, un: float | None) -> dict:
    return {
        "electrolyzer": norm.el,
        "date": iso(norm.day),
        "time": norm.time,
        "current": _r(norm.current),
        "i": _r(norm.i_dens(cfg)),
        "cc": _r(norm.cc),
        "t_an": _r(norm.t_an),
        "t_ka": _r(norm.t_ka),
        "tm": _r(norm.tm()),
        "uo": _r(norm.uo),
        "um": _r(um),
        "un": _r(un),
        "iref": cfg.iref,
    }


def slot_un(norm: Norm, cfg: Cfg, table: str) -> tuple[float | None, float | None]:
    if not norm.complete:
        return None, None
    um = norm.um_table1() if table == "1" else norm.um_table2()
    if um is None:
        return None, None
    return um, unber(um, norm.i_dens(cfg), norm.tm(), norm.cc, cfg)


def _load_slots(db: Session, cfg: Cfg, d0, d1, els, table: str) -> list[Norm]:
    d0, d1 = default_window(d0, d1)
    norms = load_norms(db, d0, d1, els)
    if table == "2":
        attach_stats(db, cfg, norms, d0, d1, els)
    return norms


def un_electrolyzer_rows(db: Session, cfg: Cfg, *, table: str, d0, d1, els: set[str] | None) -> Result:
    """qryUnElektrolyseur / qryUnElektrolyseure / qryUnAlleElektrolyseure (+ "2" variants)."""
    rows = []
    for norm in _load_slots(db, cfg, d0, d1, els, table):
        um, un = slot_un(norm, cfg, table)
        if un is None:
            continue
        rows.append(_slot_row(norm, cfg, um, un))
    return Result(UN_SLOT_COLUMNS, rows, "un", "Un [V]", "electrolyzer")


UN_AGG_COLUMNS = [
    col("date", "Date", "left"),
    col("current", "I total [kA]"),
    col("i", "i [kA/m²]"),
    col("cc", "Cc [% NaOH]"),
    col("t_ka", "t Ka [°C]"),
    col("t_an", "t An [°C]"),
    col("un", "Un [V]"),
    col("iref", "iRef"),
    col("count", "n"),
]


def _agg_slots(norms: list[Norm], cfg: Cfg, table: str) -> dict[date, dict]:
    """Per-day aggregate of the slot rows (qryUnGesamtanlage / qryUnTeilanlage, table 1) or of
    the element rows (… 2, table 2). Table 1 averages slot rows; table 2 averages element rows,
    i.e. each slot is weighted by its number of readings."""
    days: dict[date, list] = defaultdict(list)
    for norm in norms:
        um, un = slot_un(norm, cfg, table)
        if un is None:
            continue
        weight = 1.0 if table == "1" else float(norm.stats[0])
        days[norm.day].append((norm, um, un, weight))
    out: dict[date, dict] = {}
    for day, items in days.items():
        out[day] = {
            "current": wavg((n.current, w) for n, _, _, w in items),
            "i": wavg((n.i_dens(cfg), w) for n, _, _, w in items),
            "cc": wavg((n.cc, w) for n, _, _, w in items),
            "t_an": wavg((n.t_an, w) for n, _, _, w in items),
            "t_ka": wavg((n.t_ka, w) for n, _, _, w in items),
            "tm": wavg((n.tm(), w) for n, _, _, w in items),
            "uo": wavg((n.uo, w) for n, _, _, w in items),
            "un": wavg((un, w) for _, _, un, w in items),
            "count": int(round(sum(w for _, _, _, w in items))),
        }
    return out


def _agg_row(day: date, data: dict, cfg: Cfg, extra: dict | None = None) -> dict:
    row = {"date": iso(day)}
    if extra:
        row.update(extra)
    row.update(
        {
            "current": _r(data["current"]),
            "i": _r(data["i"]),
            "cc": _r(data["cc"]),
            "t_an": _r(data["t_an"]),
            "t_ka": _r(data["t_ka"]),
            "un": _r(data["un"]),
            "iref": cfg.iref,
            "count": data["count"],
        }
    )
    return row


def un_plant_rows(db: Session, cfg: Cfg, *, table: str, d0, d1) -> Result:
    """qryUnGesamtanlage (table 1) / qryUnGesamtanlage2 (table 2)."""
    norms = _load_slots(db, cfg, d0, d1, None, table)
    agg = _agg_slots(norms, cfg, table)
    rows = [_agg_row(day, agg[day], cfg) for day in sorted(agg)]
    return Result(UN_AGG_COLUMNS, rows, "un", "Un [V]")


def un_train_rows(db: Session, cfg: Cfg, *, table: str, d0, d1, trains: set[str] | None) -> Result:
    """qryUnTeilanlage / qryUnAlleTeilanlagen (+2)."""
    tmap = train_map(db)
    norms = _load_slots(db, cfg, d0, d1, None, table)
    by_train: dict[str, list[Norm]] = defaultdict(list)
    for norm in norms:
        train = train_of_key(norm.el, tmap)
        if train is None or (trains is not None and train not in trains):
            continue
        by_train[train].append(norm)
    rows = []
    for train in sorted(by_train):
        agg = _agg_slots(by_train[train], cfg, table)
        for day in sorted(agg):
            rows.append(_agg_row(day, agg[day], cfg, {"train": train}))
    columns = [col("train", "Train", "left"), *UN_AGG_COLUMNS]
    return Result(columns, rows, "un", "Un [V]", "train")


# --- groups ---------------------------------------------------------------


@dataclass
class Member:
    el: str
    pos: str
    group: str
    start: date | None
    end: date | None
    membrane: str
    gap: str


def load_members(db: Session, *, active_only: bool) -> list[Member]:
    """Montage rows. ``active_only``: Ausschalt Datum Is Null (Norm(Um)GR / Gruppen aktiv)."""
    q = db.query(models.Element)
    if active_only:
        q = q.filter(models.Element.decommissioning_date.is_(None))
    out = []
    for el in q.all():
        group = gkey(el.group_nr)
        key = ekey(el.electrolyzer)
        pos = pkey(el.position)
        if not group or group == "0" or not key or not pos:
            continue
        out.append(
            Member(
                el=key,
                pos=pos,
                group=group,
                start=day_of(el.commissioning_date),
                end=day_of(el.decommissioning_date),
                membrane=(el.membrane_type or "").strip(),
                gap=(el.gap_mm or "").strip(),
            )
        )
    return out


UN_GROUP_COLUMNS = [
    col("group", "Group", "left"),
    col("date", "Date", "left"),
    col("count", "No. of elements"),
    col("membrane", "Membrane type", "left"),
    col("gap", "Electrode gap", "left"),
    col("anode_coating", "Anode coating", "left"),
    col("cathode_coating", "Cathode coating", "left"),
    col("i", "i [kA/m²]"),
    col("un", "Un [V]"),
    col("iref", "iRef"),
]


def _group_defs(db: Session) -> dict[str, models.GroupDefinition]:
    return {gkey(g.group_nr): g for g in db.query(models.GroupDefinition).all()}


def un_group_rows(
    db: Session, cfg: Cfg, *, table: str, calc: str, d0, d1, groups: set[str] | None
) -> Result:
    d0, d1 = default_window(d0, d1)
    defs = _group_defs(db)

    if table == "2":
        # qryUnGruppe2 / qryUnMehrereGruppen2 / qryUnAlleGruppen2: entered group data.
        q = db.query(models.VoltageUnGroupInput).filter(
            models.VoltageUnGroupInput.date >= _dt(d0),
            models.VoltageUnGroupInput.date < _dt(d1 + timedelta(days=1)),
        )
        rows = []
        for r in q.all():
            group = gkey(r.group_nr)
            if not group or (groups is not None and group not in groups):
                continue
            if None in (_f(r.total_current), _f(r.naoh_pct), _f(r.anolyte_temp), _f(r.catholyte_temp), _f(r.total_voltage)) or not r.element_count:
                continue
            i = _f(r.total_current) / cfg.area
            tm = (_f(r.anolyte_temp) + _f(r.catholyte_temp)) / 2
            ui = _f(r.total_voltage) / r.element_count
            un = unber(ui, i, tm, _f(r.naoh_pct), cfg)
            if un is None:
                continue
            gd = defs.get(group)
            rows.append(
                {
                    "group": group,
                    "date": iso(day_of(r.date)),
                    "time": tkey(r.time),
                    "count": int(r.element_count),
                    "membrane": (gd.membrane_type if gd else None) or "",
                    "gap": (gd.gap_mm if gd else None) or "",
                    "anode_coating": (gd.anode_coating if gd else None) or "",
                    "cathode_coating": (gd.cathode_coating if gd else None) or "",
                    "current": _r(_f(r.total_current)),
                    "i": _r(i),
                    "cc": _r(_f(r.naoh_pct)),
                    "t_an": _r(_f(r.anolyte_temp)),
                    "t_ka": _r(_f(r.catholyte_temp)),
                    "tm": _r(tm),
                    "ug": _r(_f(r.total_voltage)),
                    "ui": _r(ui),
                    "un": _r(un),
                    "iref": cfg.iref,
                }
            )
        rows.sort(key=lambda x: (x["group"], x["date"] or "", x["time"]))
        columns = [
            col("group", "Group", "left"),
            col("date", "Date", "left"),
            col("time", "Time", "left"),
            col("anode_coating", "Anode coating", "left"),
            col("cathode_coating", "Cathode coating", "left"),
            col("membrane", "Membrane type", "left"),
            col("gap", "Electrode gap", "left"),
            col("current", "I total [kA]"),
            col("i", "i [kA/m²]"),
            col("cc", "Cc [% NaOH]"),
            col("t_an", "t An [°C]"),
            col("t_ka", "t Ka [°C]"),
            col("ug", "U total [V]"),
            col("count", "n"),
            col("ui", "Ui [V]"),
            col("un", "Un [V]"),
            col("iref", "iRef"),
        ]
        return Result(columns, rows, "un", "Un [V]", "group")

    # table 1: element readings joined with the Montage table.
    active_only = calc == "individual"  # UnGruppen (Ausschalt Is Null) vs ListGr (no such filter)
    members = load_members(db, active_only=active_only)
    if groups is not None:
        members = [m for m in members if m.group in groups]
    if active_only:
        members = [m for m in members if m.start is not None]
    by_pos: dict[tuple[str, str], list[Member]] = defaultdict(list)
    for m in members:
        if m.start is not None:
            by_pos[(m.el, m.pos)].append(m)
    els = {k[0] for k in by_pos}
    if not els:
        return Result(UN_GROUP_COLUMNS, [], "un", "Un [V]", "group")

    norms = load_norms(db, d0, d1, els)
    attach_stats(db, cfg, norms, d0, d1, els)
    index = NormIndex(norms)
    # Access joins the readings to the ``Um`` query on date + electrolyzer only, so every reading
    # is repeated once per (distinct, complete) slot of that electrolyzer and day. ListGr / Norm(Um)GR
    # then average these repeated rows -> each reading is weighted by that slot count.
    um_rows: dict[tuple[str, date], set] = defaultdict(set)
    for norm in norms:
        if norm.complete and norm.stats and norm.stats[0]:
            um_rows[(norm.el, norm.day)].add((norm.time, norm.current, norm.cc, norm.t_an, norm.t_ka, norm.uo))
    acc: dict[tuple, list[float]] = defaultdict(lambda: [0.0, 0.0, 0])
    for el, pos, day, time, ui, nr in stream_readings(db, cfg, d0, d1, els):
        mlist = by_pos.get((el, pos))
        if not mlist or day is None:
            continue
        norm = index.find(el, day, time, nr)
        if norm is None or not norm.complete:
            continue
        i = norm.i_dens(cfg)
        un = unber(ui, i, norm.tm(), norm.cc, cfg)
        if un is None:
            continue
        weight = max(1, len(um_rows.get((el, day), ())))
        for m in mlist:
            if m.start is None or day < m.start:
                continue
            key = (day, m.group, m.membrane, m.gap) if active_only else (day, m.group, "", "")
            bucket = acc[key]
            bucket[0] += un * weight
            bucket[1] += i * weight
            bucket[2] += weight

    counts: dict[tuple[str, str, str], int] = defaultdict(int)
    for m in load_members(db, active_only=True):
        if m.start is not None:
            counts[(m.group, m.membrane, m.gap)] += 1
    rows = []
    for (day, group, membrane, gap), (sum_un, sum_i, cnt) in sorted(acc.items(), key=lambda kv: (kv[0][1], kv[0][0], kv[0][2])):
        gd = defs.get(group)
        rows.append(
            {
                "group": group,
                "date": iso(day),
                "count": counts.get((group, membrane, gap)) if active_only else None,
                "membrane": membrane if active_only else "",
                "gap": gap if active_only else "",
                "anode_coating": (gd.anode_coating if gd else None) or "",
                "cathode_coating": (gd.cathode_coating if gd else None) or "",
                "i": _r(sum_i / cnt),
                "un": _r(sum_un / cnt),
                "iref": cfg.iref,
                "readings": cnt,
            }
        )
    return Result(UN_GROUP_COLUMNS, rows, "un", "Un [V]", "group")


# --- elements -------------------------------------------------------------

UN_ELEMENT_COLUMNS = [
    col("electrolyzer", "Electrolyzer", "left"),
    col("position", "Pos.", "left"),
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("current", "I total [kA]"),
    col("i", "i [kA/m²]"),
    col("cc", "Cc [% NaOH]"),
    col("t_an", "t An [°C]"),
    col("t_ka", "t Ka [°C]"),
    col("tm", "tm [°C]"),
    col("uo", "Uo [V]"),
    col("ui", "Ui [V]"),
    col("um", "Um [V]"),
    col("ti", "ti [°C]"),
    col("un", "Un [V]"),
    col("iref", "iRef"),
]


def un_element_rows(
    db: Session,
    cfg: Cfg,
    *,
    table: str,
    d0,
    d1,
    elements: set[tuple[str, str]] | None,
    limit: int = 5000,
) -> Result:
    d0, d1 = default_window(d0, d1)
    rows: list[dict] = []
    total = 0

    if table == "2":
        q = db.query(models.VoltageUnElementInput).filter(
            models.VoltageUnElementInput.date >= _dt(d0),
            models.VoltageUnElementInput.date < _dt(d1 + timedelta(days=1)),
        )
        for r in q.all():
            key = (ekey(r.electrolyzer), pkey(r.position))
            if elements is not None and key not in elements:
                continue
            if None in (_f(r.total_current), _f(r.naoh_pct), _f(r.anolyte_temp), _f(r.catholyte_temp)):
                continue
            i = _f(r.total_current) / cfg.area
            tm = (_f(r.anolyte_temp) + _f(r.catholyte_temp)) / 2
            um = _f(r.voltage)
            un = unber(um, i, tm, _f(r.naoh_pct), cfg)
            if un is None:
                continue
            rows.append(
                {
                    "electrolyzer": key[0],
                    "position": key[1],
                    "label": f"El. {key[0]} Pos. {key[1]}",
                    "date": iso(day_of(r.date)),
                    "time": tkey(r.time),
                    "current": _r(_f(r.total_current)),
                    "i": _r(i),
                    "cc": _r(_f(r.naoh_pct)),
                    "t_an": _r(_f(r.anolyte_temp)),
                    "t_ka": _r(_f(r.catholyte_temp)),
                    "tm": _r(tm),
                    "um": _r(um),
                    "ui": _r(um),
                    "un": _r(un),
                    "iref": cfg.iref,
                }
            )
        rows.sort(key=lambda x: (x["electrolyzer"], int(x["position"]) if x["position"].isdigit() else 0, x["date"] or "", x["time"]))
        total = len(rows)
        columns = [c for c in UN_ELEMENT_COLUMNS if c["key"] not in ("uo", "ui", "ti")]
        return Result(columns, rows[:limit], "un", "Un [V]", "label", truncated=total > limit, total=total)

    els = {k[0] for k in elements} if elements is not None else None
    norms = load_norms(db, d0, d1, els)
    attach_stats(db, cfg, norms, d0, d1, els)
    index = NormIndex(norms)
    for el, pos, day, time, ui, nr in stream_readings(db, cfg, d0, d1, els):
        if elements is not None and (el, pos) not in elements:
            continue
        norm = index.find(el, day, time, nr)
        if norm is None or not norm.complete:
            continue
        i = norm.i_dens(cfg)
        tm = norm.tm()
        um = norm.um_table2()  # Um: mean of Ui above Umin over the whole slot
        ti = ti_element(tm, um, ui, cfg)
        un = unber(ui, i, ti, norm.cc, cfg)
        if un is None:
            continue
        total += 1
        rows.append(
            {
                "electrolyzer": el,
                "position": pos,
                "label": f"El. {el} Pos. {pos}",
                "date": iso(day),
                "time": time,
                "current": _r(norm.current),
                "i": _r(i),
                "cc": _r(norm.cc),
                "t_an": _r(norm.t_an),
                "t_ka": _r(norm.t_ka),
                "tm": _r(tm),
                "uo": _r(norm.uo),
                "ui": _r(ui),
                "um": _r(um),
                "ti": _r(ti),
                "un": _r(un),
                "iref": cfg.iref,
            }
        )
    rows.sort(key=lambda x: (x["electrolyzer"], int(x["position"]) if x["position"].isdigit() else 0, x["date"] or "", x["time"]))
    return Result(UN_ELEMENT_COLUMNS, rows[:limit], "un", "Un [V]", "label", truncated=total > limit, total=total)


# ---------------------------------------------------------------------------
# Current efficiency
# ---------------------------------------------------------------------------

PB_FIELDS = {
    "flow": ("flow rate", "flow_rate"),
    "naclo3": ("NaClO3 Pb", "NaClO3"),
    "so4": ("Na2SO4 Pb", "Na2SO4"),
    "naoh": ("NaOH Pb", "NaOH"),
    "na2co3": ("Na2CO3 Pb", "Na2CO3"),
    "naocl": ("NaOCl Pb", "NaOCl", "HOCl"),
    "hcl": ("HCl Pb", "HCl"),
}
AN_FIELDS = {
    "naclo3": ("NaClO3 An", "NaClO3"),
    "so4": ("Na2SO4 An", "Na2SO4"),
    "naocl": ("NaOCl An", "NaOCl", "HOCl"),
    "hcl": ("HCl An", "HCl"),
}
CL_FIELDS = {
    "cl2": ("Cl2 + CO2 Cl", "Cl2 + CO2", "Cl2_CO2"),
    "o2": ("O2 Cl", "O2"),
}


def _params(sample: models.AnalysisSample) -> dict:
    raw = sample.parameters
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        import json

        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def _pick(params: dict, names: tuple[str, ...]) -> float | None:
    for name in names:
        if name in params and params[name] not in (None, ""):
            value = _f(params[name])
            if value is not None:
                return value
    return None


def _extract(sample: models.AnalysisSample, fields: dict) -> dict:
    params = _params(sample)
    out = {key: _pick(params, names) for key, names in fields.items()}
    out["time"] = tkey(sample.time)
    return out


def load_analyses(db: Session, scope: str, d0: date, d1: date) -> dict[str, dict[tuple, list[dict]]]:
    """analysis type -> key -> [values]. Key is (el, day) / (group, day) / (el, pos, day)."""
    q = db.query(models.AnalysisSample).filter(
        models.AnalysisSample.scope == scope,
        models.AnalysisSample.analysis_type.in_(["anolyte", "pure_brine", "chlorine_gas"]),
        models.AnalysisSample.date >= _dt(d0),
        models.AnalysisSample.date < _dt(d1 + timedelta(days=1)),
    )
    fields = {"anolyte": AN_FIELDS, "pure_brine": PB_FIELDS, "chlorine_gas": CL_FIELDS}
    out: dict[str, dict[tuple, list[dict]]] = {"anolyte": defaultdict(list), "pure_brine": defaultdict(list), "chlorine_gas": defaultdict(list)}
    for sample in q.order_by(models.AnalysisSample.id).all():
        day = day_of(sample.date)
        if day is None:
            continue
        if scope == "electrolyzer":
            key = (ekey(sample.electrolyzer), day)
            if not key[0]:
                continue
        elif scope == "group":
            key = (gkey(sample.group_nr), day)
            if not key[0]:
                continue
        else:
            key = (ekey(sample.electrolyzer), pkey(sample.position), day)
            if not key[0] or not key[1]:
                continue
        out[sample.analysis_type][key].append(_extract(sample, fields[sample.analysis_type]))
    return out


CE_COLUMNS_TAIL = [
    col("mu_naclo3", "µNaClO3 [%]"),
    col("mu_naocl", "µNaOCl [%]"),
    col("mu_hcl", "µHCl [%]"),
    col("mu_o2", "µO2 [%]"),
    col("mu_alkali", "µAlkali [%]"),
    col("mu_na2co3", "µNa2CO3 [%]"),
    col("mu_naoh", "µNaOH = CE [%]"),
]
CE_ELECTROLYZER_COLUMNS = [
    col("electrolyzer", "Electrolyzer", "left"),
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("v_anolyte", "V Anolyte [m³/h]"),
    *CE_COLUMNS_TAIL,
    col("current", "I total [kA]"),
    col("cells", "n"),
]


def _ce_row(base: dict, calc: dict, current, cells) -> dict:
    row = dict(base)
    for key, value in calc.items():
        row[key] = _r(value)
    row["current"] = _r(current)
    row["cells"] = cells
    return row


def ce_electrolyzer_base(db: Session, cfg: Cfg, d0, d1, els: set[str] | None) -> list[dict]:
    """qryCEAlleElektrolyseure: StromAus2 x StromAusVAno x UnElekFV x Analyse Chlorgas.

    Every combination of anolyte analysis, pure-brine analysis, chlorine-gas analysis and
    NormElek row of the same electrolyzer and day is one result row (exactly as the Access
    joins on date + electrolyzer only)."""
    d0, d1 = default_window(d0, d1)
    ana = load_analyses(db, "electrolyzer", d0, d1)
    norms = load_norms(db, d0, d1, els)
    norms_by: dict[tuple[str, date], list[Norm]] = defaultdict(list)
    for norm in norms:
        if norm.current is not None and norm.n:
            norms_by[(norm.el, norm.day)].append(norm)
    rows = []
    for key, an_list in sorted(ana["anolyte"].items(), key=lambda kv: (kv[0][0], kv[0][1])):
        el, day = key
        if els is not None and el not in els:
            continue
        for an in an_list:
            for pb in ana["pure_brine"].get(key, []):
                for cl in ana["chlorine_gas"].get(key, []):
                    for norm in norms_by.get(key, []):
                        calc = ce_balance(cfg, n=norm.n, i=norm.current, pb=pb, an=an, cl=cl)
                        if calc is None:
                            continue
                        rows.append(
                            _ce_row(
                                {"electrolyzer": el, "date": iso(day), "time": an["time"]},
                                calc,
                                norm.current,
                                norm.n,
                            )
                        )
    return rows


def ce_electrolyzer_rows(db: Session, cfg: Cfg, *, d0, d1, els: set[str] | None) -> Result:
    rows = ce_electrolyzer_base(db, cfg, d0, d1, els)
    return Result(CE_ELECTROLYZER_COLUMNS, rows, "mu_naoh", "CE [%]", "electrolyzer")


CE_AGG_COLUMNS = [
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("count", "No. of electrolyzers"),
    col("v_anolyte", "V Anolyte [m³/h]"),
    *CE_COLUMNS_TAIL,
]


def _ce_aggregate(rows: list[dict], *, sum_v: bool) -> dict:
    def a(key):
        return _r(avg(r.get(key) for r in rows))

    out = {
        "count": len(rows),
        "v_anolyte": _r(sum(r["v_anolyte"] for r in rows)) if sum_v else a("v_anolyte"),
        "conc_cl2": a("conc_cl2"),
        "conc_o2": a("conc_o2"),
    }
    for key in ("mu_naclo3", "mu_naocl", "mu_hcl", "mu_o2", "mu_alkali", "mu_na2co3", "mu_naoh"):
        out[key] = a(key)
    return out


def ce_train_rows(db: Session, cfg: Cfg, *, d0, d1, trains: set[str] | None) -> Result:
    """qryCETeilanlage / qryCEAlleTeilanlagen: per train, date and time (V = sum)."""
    tmap = train_map(db)
    base = ce_electrolyzer_base(db, cfg, d0, d1, None)
    groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for row in base:
        train = train_of_key(row["electrolyzer"], tmap)
        if train is None or (trains is not None and train not in trains):
            continue
        groups[(train, row["date"], row["time"])].append(row)
    rows = []
    for (train, day, time), items in sorted(groups.items()):
        rows.append({"train": train, "date": day, "time": time, **_ce_aggregate(items, sum_v=True)})
    columns = [col("train", "Train", "left"), *CE_AGG_COLUMNS]
    return Result(columns, rows, "mu_naoh", "CE [%]", "train")


def ce_plant_rows(db: Session, cfg: Cfg, *, d0, d1) -> Result:
    """qryCEGesamtanlage: per date, plain averages of all electrolyzer rows."""
    base = ce_electrolyzer_base(db, cfg, d0, d1, None)
    groups: dict[str, list[dict]] = defaultdict(list)
    for row in base:
        groups[row["date"]].append(row)
    rows = []
    for day in sorted(groups):
        rows.append({"date": day, **_ce_aggregate(groups[day], sum_v=False)})
    columns = [c for c in CE_AGG_COLUMNS if c["key"] != "time"]
    return Result(columns, rows, "mu_naoh", "CE [%]")


CE_GROUP_COLUMNS = [
    col("group", "Group", "left"),
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("v_anolyte", "V Anolyte [m³/h]"),
    *CE_COLUMNS_TAIL,
    col("current", "I total [kA]"),
    col("cells", "n"),
]
CE_ELEMENT_COLUMNS = [
    col("label", "Element", "left"),
    col("date", "Date", "left"),
    col("time", "Time", "left"),
    col("v_anolyte", "V Anolyte [m³/h]"),
    *CE_COLUMNS_TAIL,
    col("current", "I total [kA]"),
]


def ce_group_rows(db: Session, cfg: Cfg, *, d0, d1, groups: set[str] | None) -> Result:
    """qryCEGruppe / qryCEMehrereGruppen / qryCEAlleGruppen: the entered group Un data
    (tblEingabeUnGruppe: n, I total) joined with the group analyses of the same date."""
    d0, d1 = default_window(d0, d1)
    ana = load_analyses(db, "group", d0, d1)
    q = db.query(models.VoltageUnGroupInput).filter(
        models.VoltageUnGroupInput.date >= _dt(d0),
        models.VoltageUnGroupInput.date < _dt(d1 + timedelta(days=1)),
    )
    rows = []
    for inp in q.order_by(models.VoltageUnGroupInput.date).all():
        group = gkey(inp.group_nr)
        day = day_of(inp.date)
        if not group or day is None or (groups is not None and group not in groups):
            continue
        key = (group, day)
        for an in ana["anolyte"].get(key, []):
            for pb in ana["pure_brine"].get(key, []):
                for cl in ana["chlorine_gas"].get(key, []):
                    calc = ce_balance(cfg, n=inp.element_count, i=_f(inp.total_current), pb=pb, an=an, cl=cl)
                    if calc is None:
                        continue
                    rows.append(
                        _ce_row(
                            {"group": group, "date": iso(day), "time": tkey(inp.time)},
                            calc,
                            _f(inp.total_current),
                            inp.element_count,
                        )
                    )
    return Result(CE_GROUP_COLUMNS, rows, "mu_naoh", "CE [%]", "group")


def ce_element_rows(db: Session, cfg: Cfg, *, d0, d1, elements: set[tuple[str, str]] | None) -> Result:
    """qryCEElement / qryCEMehrereElemente / qryCEAlleElemente (n = 1, I from tblEingabeUnElement)."""
    d0, d1 = default_window(d0, d1)
    ana = load_analyses(db, "element", d0, d1)
    q = db.query(models.VoltageUnElementInput).filter(
        models.VoltageUnElementInput.date >= _dt(d0),
        models.VoltageUnElementInput.date < _dt(d1 + timedelta(days=1)),
    )
    rows = []
    for inp in q.order_by(models.VoltageUnElementInput.date).all():
        el, pos, day = ekey(inp.electrolyzer), pkey(inp.position), day_of(inp.date)
        if not el or not pos or day is None or (elements is not None and (el, pos) not in elements):
            continue
        key = (el, pos, day)
        for an in ana["anolyte"].get(key, []):
            for pb in ana["pure_brine"].get(key, []):
                for cl in ana["chlorine_gas"].get(key, []):
                    calc = ce_balance(cfg, n=1, i=_f(inp.total_current), pb=pb, an=an, cl=cl)
                    if calc is None:
                        continue
                    rows.append(
                        _ce_row(
                            {
                                "electrolyzer": el,
                                "position": pos,
                                "label": f"El. {el} Pos. {pos}",
                                "date": iso(day),
                                "time": tkey(inp.time),
                            },
                            calc,
                            _f(inp.total_current),
                            1,
                        )
                    )
    return Result(CE_ELEMENT_COLUMNS, rows, "mu_naoh", "CE [%]", "label")


def ce_naoh_rows(
    db: Session,
    cfg: Cfg,
    *,
    scope: str,
    d0,
    d1,
    refs: set[str] | None,
    elements: set[tuple[str, str]] | None = None,
) -> Result:
    """qryCE*NaOH: the CE the operators entered from the caustic (NaOH) balance."""
    d0, d1 = default_window(d0, d1)
    scope_db = {"plant": "plant", "train": "sub_plant", "electrolyzer": "electrolyzer", "group": "group", "element": "element"}[scope]
    q = db.query(models.CurrentEfficiencyEntry).filter(
        models.CurrentEfficiencyEntry.scope == scope_db,
        models.CurrentEfficiencyEntry.date >= _dt(d0),
        models.CurrentEfficiencyEntry.date < _dt(d1 + timedelta(days=1)),
    )
    rows = []
    for entry in q.order_by(models.CurrentEfficiencyEntry.date).all():
        if entry.value_pct is None:
            continue
        day = day_of(entry.date)
        row = {"date": iso(day), "mu_naoh": _r(float(entry.value_pct))}
        if scope == "electrolyzer":
            ref = ekey(entry.scope_ref)
            if refs is not None and ref not in refs:
                continue
            row["electrolyzer"] = ref
        elif scope == "train":
            ref = (entry.scope_ref or "").strip()
            if refs is not None and ref not in refs:
                continue
            row["train"] = ref
        elif scope == "group":
            ref = gkey(entry.scope_ref)
            if refs is not None and ref not in refs:
                continue
            row["group"] = ref
        elif scope == "element":
            el, pos = ekey(entry.scope_ref), pkey(entry.position)
            if elements is not None and (el, pos) not in elements:
                continue
            row.update({"electrolyzer": el, "position": pos, "label": f"El. {el} Pos. {pos}"})
        rows.append(row)
    head: list[dict] = []
    series = None
    if scope == "electrolyzer":
        head, series = [col("electrolyzer", "Electrolyzer", "left")], "electrolyzer"
    elif scope == "train":
        head, series = [col("train", "Train", "left")], "train"
    elif scope == "group":
        head, series = [col("group", "Group", "left")], "group"
    elif scope == "element":
        head, series = [col("label", "Element", "left")], "label"
    columns = [col("date", "Date", "left"), *head, col("mu_naoh", "CE [%]")]
    rows.sort(key=lambda r: (r["date"] or "", str(r.get(series) or "")))
    return Result(columns, rows, "mu_naoh", "CE [%]", series)


# ---------------------------------------------------------------------------
# SPC (Un + CE -> specific energy) - qrySPC*
# ---------------------------------------------------------------------------

SPC_COLUMNS = [
    col("electrolyzer", "Electrolyzer", "left"),
    col("date", "Date", "left"),
    col("i", "i [kA/m²]"),
    col("un", "Un [V]"),
    col("ce", "CE [%]"),
    col("spc", "Energy [kWh/t NaOH]"),
    col("iref", "iRef"),
]


def spc_electrolyzer_rows(
    db: Session, cfg: Cfg, *, un_table: str, ce_basis: str, d0, d1, els: set[str] | None
) -> Result:
    """qrySPC(Alle/Mehrere)Elektrolyseur(e)(2/3/4): Un x CE of the same electrolyzer and date."""
    un_rows = un_electrolyzer_rows(db, cfg, table=un_table, d0=d0, d1=d1, els=els).rows
    if ce_basis == "naoh":
        ce_rows = ce_naoh_rows(db, cfg, scope="electrolyzer", d0=d0, d1=d1, refs=els).rows
    else:
        ce_rows = ce_electrolyzer_rows(db, cfg, d0=d0, d1=d1, els=els).rows
    ce_by: dict[tuple[str, str], list[float]] = defaultdict(list)
    for r in ce_rows:
        if r.get("mu_naoh") is not None:
            ce_by[(r["electrolyzer"], r["date"])].append(r["mu_naoh"])
    rows = []
    for u in un_rows:
        for ce in ce_by.get((u["electrolyzer"], u["date"]), []):
            rows.append(
                {
                    "electrolyzer": u["electrolyzer"],
                    "date": u["date"],
                    "i": u["i"],
                    "un": u["un"],
                    "ce": ce,
                    "spc": _r(spc(u["un"], ce), 2),
                    "iref": cfg.iref,
                }
            )
    rows.sort(key=lambda r: (r["electrolyzer"], r["date"]))
    return Result(SPC_COLUMNS, rows, "spc", "Energy [kWh/t NaOH]", "electrolyzer")


def spc_plant_rows(db: Session, cfg: Cfg, *, un_table: str, d0, d1) -> Result:
    """qrySPCGesamtanlage: per date the average SPC of Un(plant) and CE(plant)."""
    un_rows = {r["date"]: r for r in un_plant_rows(db, cfg, table=un_table, d0=d0, d1=d1).rows}
    ce_rows = {r["date"]: r for r in ce_plant_rows(db, cfg, d0=d0, d1=d1).rows}
    rows = []
    for day in sorted(set(un_rows) & set(ce_rows)):
        un, ce = un_rows[day]["un"], ce_rows[day]["mu_naoh"]
        rows.append(
            {
                "electrolyzer": "Total plant",
                "date": day,
                "i": un_rows[day]["i"],
                "un": un,
                "ce": ce,
                "spc": _r(spc(un, ce), 2),
                "iref": cfg.iref,
            }
        )
    return Result(SPC_COLUMNS, rows, "spc", "Energy [kWh/t NaOH]", "electrolyzer")
