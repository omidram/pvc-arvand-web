"""
Engineering calculations from the Uhde Administrator operating manual
and from Access VBA ``ModBerechnungen`` (the plant's working formulas).

Current-efficiency formulas below match Access ``Eta*Ber`` / ``VAnolytBer``
exactly. Standardized voltage follows Access ``UnBer``.
"""
from __future__ import annotations

from dataclasses import dataclass


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
    from datetime import date as date_cls
    from datetime import datetime as datetime_cls

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
    from datetime import date as date_cls

    start = _as_date(commissioning_date)
    if not start:
        return None
    end = _as_date(decommissioning_date) or reference_today or date_cls.today()
    return (end - start).days


def installation_dol(
    assembly_date, commissioning_date, disassembly_date, decommissioning_date=None, reference_today=None
) -> int | None:
    """Days on line from installation (or assembly, if it was never dated separately) until dismantle.

    End is the dismantle date, otherwise the shutdown date, otherwise today while the cell is still in.
    """
    from datetime import date as date_cls

    start = _as_date(commissioning_date) or _as_date(assembly_date)
    if not start:
        return None
    end = _as_date(disassembly_date) or _as_date(decommissioning_date) or reference_today or date_cls.today()
    if end < start:
        return 0
    return (end - start).days
