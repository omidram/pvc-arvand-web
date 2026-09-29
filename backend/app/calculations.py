"""
Engineering calculations from the Uhde Administrator operating manual
(section 3.5 "Standardized Voltage" and 3.6 "Current Efficiency").

These are re-implemented from the manual's formulas. The OCR of the original
PDF garbles the equation layout, so the coefficients below follow the
textual description in the manual as closely as possible. Treat results as
a helpful estimate and validate against known-good historical values before
relying on them for critical decisions.
"""
from dataclasses import dataclass


@dataclass
class StandardizedVoltageResult:
    standardized_voltage: float
    inputs: dict


def standardized_voltage(
    u_meas: float,
    current_density: float,
    reference_current_density: float,
    zero_voltage: float,
    temp_meas: float,
    temp_ref: float,
    conc_meas: float,
    conc_ref: float,
    temp_correction: float,
    conc_correction: float,
) -> StandardizedVoltageResult:
    """
    Un = U - (i_ref/i - 1) * (U - U0) - c_T * (T - T_ref) - c_C * (C - C_ref)

    - u_meas: measured voltage [V] (single element, or electrolyzer total / element count)
    - current_density: measured average current density [kA/m^2]
    - reference_current_density: standard current density (6 for NaOH, 5 for KOH) [kA/m^2]
    - zero_voltage: U0 [V] (2.40 NaOH / 2.42 KOH)
    - temp_meas / temp_ref: outlet temperature, measured vs standard (90 degC) [degC]
    - conc_meas / conc_ref: outlet concentration, measured vs standard (32% NaOH, 28.5/30.5% KOH) [%w/w]
    - temp_correction: V per degree at reference current density (0.020 NaOH / 0.016 KOH)
    - conc_correction: V per %w/w at reference current density (0.040 NaOH / 0.033 KOH)
    """
    if not current_density:
        raise ValueError("current_density must be non-zero")

    scale = reference_current_density / current_density
    un = (
        u_meas
        - (scale - 1) * (u_meas - zero_voltage)
        - temp_correction * scale * (temp_meas - temp_ref)
        - conc_correction * scale * (conc_meas - conc_ref)
    )
    return StandardizedVoltageResult(
        standardized_voltage=round(un, 4),
        inputs={
            "u_meas": u_meas,
            "current_density": current_density,
            "reference_current_density": reference_current_density,
            "zero_voltage": zero_voltage,
            "temp_meas": temp_meas,
            "temp_ref": temp_ref,
            "conc_meas": conc_meas,
            "conc_ref": conc_ref,
        },
    )


@dataclass
class CurrentEfficiencyResult:
    eta_naclo3: float | None
    eta_hocl: float | None
    eta_hcl: float | None
    eta_alkali: float | None
    eta_na2co3: float | None
    eta_membrane: float | None
    notes: list[str]


def current_efficiency(
    n_cells: int,
    current_ka: float,
    v_pure_brine: float | None,
    v_anolyte: float | None,
    c_naclo3_pb: float | None = None,
    c_naclo3_an: float | None = None,
    c_hocl_an: float | None = None,
    c_hcl_pb: float | None = None,
    c_hcl_an: float | None = None,
    c_naoh_pb: float | None = None,
    c_na2co3_pb: float | None = None,
    acidified: bool = False,
) -> CurrentEfficiencyResult:
    """
    Implements formulas (2), (3), (4), (5), (6) and (8) from the manual's
    "Current Efficiency" section (anodic balance method). Formula (1)
    (deriving V' from sulfate balance) and (7) (oxygen-balance cross-check)
    require additional analytical inputs (SO4, O2/Cl2 cell-gas) that are
    frequently unavailable; they are intentionally omitted rather than
    guessed. eta_membrane is therefore computed as the complement of the
    known loss terms only, and should be read as an approximation.
    """
    notes: list[str] = []
    denom = n_cells * current_ka
    if not denom:
        raise ValueError("n_cells and current_ka must be non-zero")

    v = v_pure_brine
    v_p = v_anolyte

    eta_naclo3 = None
    if v is not None and v_p is not None and c_naclo3_pb is not None and c_naclo3_an is not None:
        eta_naclo3 = (v * c_naclo3_pb - v_p * c_naclo3_an) / (0.662 * denom) * 100
    else:
        notes.append("eta_naclo3 skipped: needs pure-brine and anolyte flow + NaClO3 concentrations")

    eta_hocl = None
    if v_p is not None and c_hocl_an is not None:
        eta_hocl = (v_p * c_hocl_an) / (0.980 * denom) * 100
    else:
        notes.append("eta_hocl skipped: needs anolyte flow + HOCl concentration")

    eta_hcl = None
    if acidified:
        if v is not None and v_p is not None and c_hcl_pb is not None and c_hcl_an is not None:
            eta_hcl = (v * c_hcl_pb - v_p * c_hcl_an) / (1.36 * denom) * 100
        else:
            notes.append("eta_hcl skipped: needs pure-brine and anolyte flow + HCl concentrations")
    else:
        eta_hcl = 0.0

    eta_alkali = None
    if v is not None and c_naoh_pb is not None:
        eta_alkali = (v * c_naoh_pb) / (1.4923 * denom) * 100
    else:
        notes.append("eta_alkali skipped: needs pure-brine flow + NaOH concentration")

    eta_na2co3 = None
    if v is not None and c_na2co3_pb is not None:
        eta_na2co3 = (v * c_na2co3_pb) / (1.978 * denom) * 100
    else:
        notes.append("eta_na2co3 skipped: needs pure-brine flow + Na2CO3 concentration")

    known_losses = [x for x in [eta_naclo3, eta_hocl, eta_hcl, eta_na2co3] if x is not None]
    eta_membrane = None
    if known_losses and eta_alkali is not None:
        eta_membrane = eta_alkali - sum(known_losses)
        notes.append(
            "eta_membrane approximated as eta_alkali minus known loss terms; "
            "the oxygen cell-gas cross-check (formula 7/8) was not applied."
        )

    return CurrentEfficiencyResult(
        eta_naclo3=round(eta_naclo3, 3) if eta_naclo3 is not None else None,
        eta_hocl=round(eta_hocl, 3) if eta_hocl is not None else None,
        eta_hcl=round(eta_hcl, 3) if eta_hcl is not None else None,
        eta_alkali=round(eta_alkali, 3) if eta_alkali is not None else None,
        eta_na2co3=round(eta_na2co3, 3) if eta_na2co3 is not None else None,
        eta_membrane=round(eta_membrane, 3) if eta_membrane is not None else None,
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


def installation_dol(assembly_date, commissioning_date, disassembly_date, decommissioning_date=None, reference_today=None) -> int | None:
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
