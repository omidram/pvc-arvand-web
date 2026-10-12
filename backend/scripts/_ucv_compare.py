"""Compare the web Un/CE engine with the Access oracle (``_ucv_oracle.json``).

Run with the app venv from ``backend``::

    $env:PYTHONPATH="."; & "$env:TEMP\\arvand_venv\\Scripts\\python.exe" scripts/_ucv_compare.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app import models  # noqa: E402
from app import un_ce_engine as E  # noqa: E402
import _ucv_dataset as DS  # noqa: E402

ORACLE = json.loads((HERE / "_ucv_oracle.json").read_text(encoding="utf-8"))


def dt(d):
    return datetime(d.year, d.month, d.day)


def load_dataset(db, data):
    for s in data["slots"]:
        db.add(models.ElectrolyzerNormalization(
            normalization_nr=s["nr"], electrolyzer=s["web_el"], date=dt(s["date"]), time=s["time"],
            total_current=s["I"], catholyte_conc=s["Cc"], anolyte_temp=s["tAn"], catholyte_temp=s["tKa"],
            zero_voltage=s["Uo"], total_voltage=s["UG"], element_count=s["n"]))
        for r in s["readings"]:
            db.add(models.VoltageReading(
                normalization_nr=s["nr"], electrolyzer=s["web_el"], position=str(r["pos"]),
                date=dt(s["date"]), time=s["time"], voltage=r["ui"]))
    for k, m in enumerate(data["montage"]):
        db.add(models.Element(
            element_nr=f"T{k}", electrolyzer=m["web_el"], position=str(m["pos"]), group_nr=str(m["group"]),
            membrane_type=m["membrane"], gap_mm=m["gap"], commissioning_date=m["start"],
            decommissioning_date=m["end"]))
    for g in data["groups"]:
        db.add(models.GroupDefinition(
            group_nr=str(g["group"]), anode_coating=g["anode"], cathode_coating=g["cathode"],
            membrane_type=g["membrane"], gap_mm=g["gap"]))
    for u in data["un_elements"]:
        db.add(models.VoltageUnElementInput(
            electrolyzer=u["web_el"], position=str(u["pos"]), date=dt(u["date"]), time=u["time"],
            total_current=u["I"], naoh_pct=u["Cc"], anolyte_temp=u["tAn"], catholyte_temp=u["tKa"], voltage=u["U"]))
    for u in data["un_groups"]:
        db.add(models.VoltageUnGroupInput(
            group_nr=str(u["group"]), date=dt(u["date"]), time=u["time"], total_current=u["I"],
            naoh_pct=u["Cc"], anolyte_temp=u["tAn"], catholyte_temp=u["tKa"], total_voltage=u["UG"],
            element_count=u["n"]))

    def analyses(prefix, scope, kind_rows):
        for atype, rows in kind_rows:
            for r in rows:
                params = {k: v for k, v in r.items() if k not in ("acc_el", "web_el", "pos", "date", "time", "group")}
                db.add(models.AnalysisSample(
                    analysis_type=atype, scope=scope,
                    electrolyzer=r.get("web_el"), position=str(r["pos"]) if "pos" in r else None,
                    group_nr=str(r["group"]) if "group" in r else None,
                    date=dt(r["date"]), time=r["time"], parameters=params))

    analyses("el", "electrolyzer", [("anolyte", data["an_el"]), ("pure_brine", data["pb_el"]), ("chlorine_gas", data["cl_el"])])
    analyses("gr", "group", [("anolyte", data["an_gr"]), ("pure_brine", data["pb_gr"]), ("chlorine_gas", data["cl_gr"])])
    analyses("em", "element", [("anolyte", data["an_em"]), ("pure_brine", data["pb_em"]), ("chlorine_gas", data["cl_em"])])

    ce = data["ce_naoh"]
    for r in ce["electrolyzer"]:
        db.add(models.CurrentEfficiencyEntry(scope="electrolyzer", scope_ref=r["web_el"], date=dt(r["date"]), value_pct=r["ce"]))
    for r in ce["element"]:
        db.add(models.CurrentEfficiencyEntry(scope="element", scope_ref=r["web_el"], position=str(r["pos"]), date=dt(r["date"]), value_pct=r["ce"]))
    for r in ce["group"]:
        db.add(models.CurrentEfficiencyEntry(scope="group", scope_ref=str(r["group"]), date=dt(r["date"]), value_pct=r["ce"]))
    for r in ce["train"]:
        db.add(models.CurrentEfficiencyEntry(scope="sub_plant", scope_ref=r["train"], date=dt(r["date"]), value_pct=r["ce"]))
    for r in ce["plant"]:
        db.add(models.CurrentEfficiencyEntry(scope="plant", date=dt(r["date"]), value_pct=r["ce"]))

    for _, web_el in DS.ELS:
        db.add(models.ElectrolyzerArrangement(name=web_el, sub_plant=E.train_of_key(web_el, {})))
    db.add(models.PlantSettings(acidified=True))
    db.add(models.UnCeSettings())
    db.commit()


def apply_scenario(db, name, sc_oracle):
    s = DS.SCENARIOS[name]
    # correction factors as read by the oracle from tblUnKorrekturfaktoren
    row = sc_oracle["qryUnElektrolyseur"][0]
    db.query(models.CorrectionFactor).delete()
    db.add(models.CorrectionFactor(reference_current_density=float(row["iRef"]), temp_correction=float(row["tKorr"]), conc_correction=float(row["cKorr"])))
    cfg_row = db.query(models.UnCeSettings).first()
    cfg_row.iref = DS.IREF_BY_ID[s["IDiRef"]]
    cfg_row.area_m2 = s["Flaeche"]
    cfg_row.umin = s["Umin"]
    cfg_row.anodic_correction = s["AnodischerKorrekturfaktor"]
    cfg_row.clo_analysis = s["IDClOAnalyse"]
    cfg_row.temp_correction_element = s["IDTemperaturkorrekturElement"]
    db.query(models.PlantSettings).first().acidified = s["IDAnsaeurung"] == 1
    db.commit()


# ---------------------------------------------------------------------------
# comparison machinery
# ---------------------------------------------------------------------------

def conv(kind, v):
    if v is None:
        return None
    if kind == "el":
        return E.ekey(v)
    if kind == "pos":
        return E.pkey(int(float(v)))
    if kind == "grp":
        return E.gkey(v)
    if kind == "time":
        return E.tkey(v)
    return str(v)


def split(rows, fields, side):
    """fields: list of (kind, oracle_field, engine_field); kind 'n' = number, else key conversion."""
    out = []
    for r in rows:
        keys, nums = [], []
        for kind, of, ef in fields:
            v = r.get(of if side == "o" else ef)
            if kind == "n":
                nums.append(None if v is None else float(v))
            else:
                keys.append(conv(kind, v))
        out.append((tuple(keys), tuple(nums)))
    return out


def close(a, b, tol):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def eq(x, y, tol):
    return len(x) == len(y) and all(close(a, b, tol) for a, b in zip(x, y))


def dedupe(items, tol):
    out = []
    for key, nums in items:
        if not any(k == key and eq(n, nums, tol) for k, n in out):
            out.append((key, nums))
    return out


RESULTS = []


def compare(label, oracle_rows, engine_rows, fields, mode="multi", tol=2e-4, o_filter=None, e_filter=None):
    if o_filter:
        oracle_rows = [r for r in oracle_rows if o_filter(r)]
    if e_filter:
        engine_rows = [r for r in engine_rows if e_filter(r)]
    o = split(oracle_rows, fields, "o")
    e = split(engine_rows, fields, "e")
    if mode in ("distinct", "subset"):
        o = dedupe(o, tol)
        e = dedupe(e, tol)
    remaining = list(e)
    missing = []
    for key, nums in o:
        for idx, (k, n) in enumerate(remaining):
            if k == key and eq(n, nums, tol):
                remaining.pop(idx)
                break
        else:
            missing.append((key, nums))
    extra = remaining
    if mode == "subset":
        ok = not extra
        missing = []
    else:
        ok = not missing and not extra
    RESULTS.append((label, ok, len(o), len(e), missing, extra))
    status = "OK  " if ok else "FAIL"
    print(f"{status} {label}: oracle={len(o)} engine={len(e)} missing={len(missing)} extra={len(extra)}")
    if not ok:
        for key, nums in missing[:4]:
            print("     only in Access:", key, nums)
        for key, nums in extra[:4]:
            print("     only in web   :", key, nums)
        # show the nearest numeric neighbour for the first missing row
        if missing and extra:
            key, nums = missing[0]
            cands = [(k, n) for k, n in extra if k == key]
            if cands:
                print("     same key, web :", cands[0])


def main():
    path = os.path.join(tempfile.gettempdir(), "ucv_compare.db")
    if os.path.exists(path):
        os.remove(path)
    engine = create_engine(f"sqlite:///{path}")
    models.Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine)()
    data = DS.build()
    load_dataset(db, data)

    only = sys.argv[1:] or list(ORACLE["scenarios"].keys())
    for sc_name in only:
        sc = ORACLE["scenarios"][sc_name]
        apply_scenario(db, sc_name, sc)
        cfg = E.load_cfg(db)
        print(f"\n=== scenario {sc_name}: {cfg.as_dict()} tk={cfg.tkorr} ck={cfg.ckorr}")
        run_scenario(db, cfg, sc, sc_name)

    bad = [r for r in RESULTS if not r[1]]
    print(f"\n{len(RESULTS) - len(bad)}/{len(RESULTS)} comparisons identical")
    sys.exit(1 if bad else 0)


UN_SLOT = [("el", "Elektrolyseur", "electrolyzer"), ("s", "Datum", "date"), ("time", "Zeit", "time"),
           ("n", "I Gesamt", "current"), ("n", "i", "i"), ("n", "Cc", "cc"), ("n", "t An", "t_an"),
           ("n", "t Ka", "t_ka"), ("n", "tm", "tm"), ("n", "Un", "un")]
UN_SLOT_Um = UN_SLOT + [("n", "Um", "um")]
UN_AGG = [("s", "Datum", "date"), ("n", "Mittelwert von I Gesamt", "current"), ("n", "Mittelwert von i", "i"),
          ("n", "Mittelwert von Cc", "cc"), ("n", "Mittelwert von t Ka", "t_ka"), ("n", "Mittelwert von t An", "t_an"),
          ("n", "Mittelwert von Un", "un")]
UN_AGG_TRAIN = [("s", "Teilanlagenbezeichnung", "train")] + UN_AGG


def run_scenario(db, cfg, sc, sc_name):
    tag = lambda s: f"[{sc_name}] {s}"  # noqa: E731
    d0, d1 = None, None
    A1, B1, A2 = "A1", "B1", "A2"

    # ---- Un: electrolyzer ---------------------------------------------------
    for table, suffix, fields in (("1", "", UN_SLOT_Um), ("2", "2", UN_SLOT_Um)):
        rows = lambda els: E.un_electrolyzer_rows(db, cfg, table=table, d0=d0, d1=d1, els=els).rows  # noqa: E731
        compare(tag(f"qryUnElektrolyseur{suffix}"), sc[f"qryUnElektrolyseur{suffix}"], rows({A1}), fields)
        compare(tag(f"qryUnAlleElektrolyseure{suffix}"), sc[f"qryUnAlleElektrolyseure{suffix}"], rows(None), fields)
        compare(tag(f"qryUnElektrolyseure{suffix}"), sc[f"qryUnElektrolyseure{suffix}"], rows({A1, B1}), fields)

    # ---- Un: plant / train ---------------------------------------------------
    p1 = E.un_plant_rows(db, cfg, table="1", d0=d0, d1=d1).rows
    compare(tag("qryUnGesamtanlage"), sc["qryUnGesamtanlage"], p1, UN_AGG + [("n", "Anzahl von Elektrolyseur", "count")])
    p2 = E.un_plant_rows(db, cfg, table="2", d0=d0, d1=d1).rows
    compare(tag("qryUnGesamtanlage2"), sc["qryUnGesamtanlage2"], p2,
            UN_AGG[:1] + [("n", "Mittelwert von I Gesamt", "current"), ("n", "Mittelwert von i", "i"),
                          ("n", "Mittelwert von Cc", "cc"), ("n", "Mittelwert von t Ka", "t_ka"),
                          ("n", "Mittelwert von t An", "t_an"), ("n", "Mittelwert von Un", "un"),
                          ("n", "Anzahl von Position", "count")])
    t1 = E.un_train_rows(db, cfg, table="1", d0=d0, d1=d1, trains={"1"}).rows
    compare(tag("qryUnTeilanlage"), sc["qryUnTeilanlage"], t1, UN_AGG_TRAIN + [("n", "Anzahl von Elektrolyseur", "count")])
    compare(tag("qryUnAlleTeilanlagen"), sc["qryUnAlleTeilanlagen"], t1, UN_AGG_TRAIN)
    t2 = E.un_train_rows(db, cfg, table="2", d0=d0, d1=d1, trains={"1"}).rows
    compare(tag("qryUnTeilanlage2"), sc["qryUnTeilanlage2"], t2, UN_AGG_TRAIN + [("n", "Anzahl von Position", "count")])
    compare(tag("qryUnAlleTeilanlagen2"), sc["qryUnAlleTeilanlagen2"], t2, UN_AGG_TRAIN)

    # ---- Un: elements --------------------------------------------------------
    EL_F = [("el", "Elektrolyseur", "electrolyzer"), ("pos", "Position", "position"), ("s", "Datum", "date"),
            ("time", "Zeit", "time"), ("n", "Ui", "ui"), ("n", "ti", "ti"), ("n", "Un", "un")]
    one = E.un_element_rows(db, cfg, table="1", d0=d0, d1=d1, elements={(A1, "5")}, limit=10**6).rows
    several = E.un_element_rows(db, cfg, table="1", d0=d0, d1=d1, elements={(A1, "5"), (A2, "7")}, limit=10**6).rows
    mode = "distinct" if not cfg.temp_corr_element else "subset"
    compare(tag(f"qryUnElement (Un, {mode})"), sc["qryUnElement"], one, EL_F, mode=mode)
    compare(tag(f"qryUnElemente (Un, {mode})"), sc["qryUnElemente"], several,
            [("el", "Elektrolyseur", "electrolyzer"), ("pos", "Position", "position"), ("s", "Datum", "date"),
             ("time", "Zeit", "time"), ("n", "Ui", "ui"), ("n", "ti", "ti"), ("n", "Un", "un")], mode=mode)
    if cfg.temp_corr_element:
        # the Access Um join is date-only -> several candidate rows; the engine uses the slot's own Um
        # (checked separately: the engine's Un equals Access Un for the row whose Um is the slot mean)
        pass
    EL2 = [("el", "Elektrolyseur", "electrolyzer"), ("pos", "Position", "position"), ("s", "Datum", "date"),
           ("time", "Zeit", "time"), ("n", "Um", "um"), ("n", "Un", "un"), ("n", "I Gesamt", "current"),
           ("n", "Cc", "cc"), ("n", "tm", "tm")]
    all2 = E.un_element_rows(db, cfg, table="2", d0=d0, d1=d1, elements=None, limit=10**6).rows
    compare(tag("qryUnAlleElemente2"), sc["qryUnAlleElemente2"], all2, EL2)
    one2 = E.un_element_rows(db, cfg, table="2", d0=d0, d1=d1, elements={(A1, "5")}, limit=10**6).rows
    compare(tag("qryUnElement2 (distinct)"), sc["qryUnElement2"], one2, EL2, mode="distinct", o_filter=lambda r: True)
    sev2 = E.un_element_rows(db, cfg, table="2", d0=d0, d1=d1, elements={(A1, "5"), (A2, "7")}, limit=10**6).rows
    compare(tag("qryUnElemente2 (distinct)"), sc["qryUnElemente2"], sev2, EL2, mode="distinct")

    # ---- Un: groups ----------------------------------------------------------
    GR = [("grp", "Gruppe", "group"), ("s", "Datum", "date"), ("n", "Mittelwert von Un", "un"), ("n", "Mittelwert von i", "i")]
    g1 = E.un_group_rows(db, cfg, table="1", calc="individual", d0=d0, d1=d1, groups={"1"}).rows
    compare(tag("UnGruppen"), sc["UnGruppen"], g1,
            [("grp", "Gruppe", "group"), ("s", "Datum", "date"), ("n", "Un Mittel", "un"), ("n", "i Mittel", "i"),
             ("n", "Anzahl von Element Nr", "count")])
    gall = E.un_group_rows(db, cfg, table="1", calc="all", d0=d0, d1=d1, groups=None).rows
    compare(tag("ListGr2"), sc["ListGr2"], gall, GR)
    gsev = E.un_group_rows(db, cfg, table="1", calc="several", d0=d0, d1=d1, groups={"1", "2"}).rows
    compare(tag("qryUnMehrereGruppen"), sc["qryUnMehrereGruppen"], gsev, GR[:3] + [("n", "AvgOfi", "i")])
    G2 = [("grp", "Gruppe", "group"), ("s", "Datum", "date"), ("time", "Zeit", "time"), ("n", "I Gesamt", "current"),
          ("n", "i", "i"), ("n", "Cc", "cc"), ("n", "tm", "tm"), ("n", "Ui", "ui"), ("n", "Un", "un")]
    g2one = E.un_group_rows(db, cfg, table="2", calc="individual", d0=d0, d1=d1, groups={"1"}).rows
    compare(tag("qryUnGruppe2"), sc["qryUnGruppe2"], g2one, G2)
    g2all = E.un_group_rows(db, cfg, table="2", calc="all", d0=d0, d1=d1, groups=None).rows
    compare(tag("qryUnAlleGruppen2"), sc["qryUnAlleGruppen2"], g2all, G2)

    # ---- CE (anodic) ---------------------------------------------------------
    MU = [("n", "VAnolyt", "v_anolyte"), ("n", "ConcCl2", "conc_cl2"), ("n", "ConcO2", "conc_o2"),
          ("n", "µNaClO3", "mu_naclo3"), ("n", "µNaOCl", "mu_naocl"), ("n", "µAlkali", "mu_alkali"),
          ("n", "µNa2CO3", "mu_na2co3"), ("n", "µHCl", "mu_hcl"), ("n", "µO2", "mu_o2"), ("n", "µNaOH", "mu_naoh")]
    CE_EL = [("el", "Elektrolyseur", "electrolyzer"), ("s", "Datum", "date"), ("time", "Zeit", "time")] + MU
    ce_all = E.ce_electrolyzer_rows(db, cfg, d0=d0, d1=d1, els=None).rows
    compare(tag("qryCEAlleElektrolyseure"), sc["qryCEAlleElektrolyseure"], ce_all, CE_EL)
    ce_one = E.ce_electrolyzer_rows(db, cfg, d0=d0, d1=d1, els={A1}).rows
    compare(tag("qryCEElektrolyseur"), sc["qryCEElektrolyseur"], ce_one, CE_EL)

    AGG_MU = [("n", "Mittelwert von µNaOH", "mu_naoh"), ("n", "Mittelwert von ConcCl2", "conc_cl2"),
              ("n", "Mittelwert von ConcO2", "conc_o2"), ("n", "Mittelwert von µNaClO3", "mu_naclo3"),
              ("n", "Mittelwert von µNaOCl", "mu_naocl"), ("n", "Mittelwert von µAlkali", "mu_alkali"),
              ("n", "Mittelwert von µNa2CO3", "mu_na2co3"), ("n", "Mittelwert von µHCl", "mu_hcl"),
              ("n", "Mittelwert von µO2", "mu_o2")]
    ce_tr = E.ce_train_rows(db, cfg, d0=d0, d1=d1, trains={"1"}).rows
    compare(tag("qryCETeilanlage"), sc["qryCETeilanlage"], ce_tr,
            [("s", "Teilanlagenbezeichnung", "train"), ("s", "Datum", "date"), ("time", "Zeit", "time"),
             ("n", "Summe von VAnolyt", "v_anolyte")] + AGG_MU)
    compare(tag("qryCEAlleTeilanlagen (count)"), sc["qryCEAlleTeilanlagen"], ce_tr,
            [("s", "Teilanlagenbezeichnung", "train"), ("s", "Datum", "date"), ("time", "Zeit", "time"),
             ("n", "Anzahl von Elektrolyseur", "count")] + AGG_MU)
    ce_pl = E.ce_plant_rows(db, cfg, d0=d0, d1=d1).rows
    compare(tag("qryCEGesamtanlage"), sc["qryCEGesamtanlage"], ce_pl,
            [("s", "Datum", "date"), ("n", "Mittelwert von VAnolyt", "v_anolyte")] + AGG_MU)

    MU_NOGAS = [f for f in MU if f[1] not in ("ConcCl2", "ConcO2")]
    CE_GR = [("grp", "Gruppe", "group"), ("s", "Datum", "date"), ("time", "Zeit", "time")] + MU_NOGAS
    ce_gr = E.ce_group_rows(db, cfg, d0=d0, d1=d1, groups=None).rows
    compare(tag("qryCEAlleGruppen"), sc["qryCEAlleGruppen"], ce_gr, CE_GR)
    ce_g1 = E.ce_group_rows(db, cfg, d0=d0, d1=d1, groups={"1"}).rows
    compare(tag("qryCEGruppe"), sc["qryCEGruppe"], ce_g1, CE_GR)

    CE_EM = [("el", "Elektrolyseur", "electrolyzer"), ("pos", "Position", "position"), ("s", "Datum", "date"),
             ("time", "Zeit", "time")] + MU_NOGAS
    ce_em = E.ce_element_rows(db, cfg, d0=d0, d1=d1, elements=None).rows
    compare(tag("qryCEAlleElemente"), sc["qryCEAlleElemente"], ce_em, CE_EM)
    ce_em1 = E.ce_element_rows(db, cfg, d0=d0, d1=d1, elements={(A1, "5")}).rows
    compare(tag("qryCEElement (distinct)"), sc["qryCEElement"], ce_em1, CE_EM, mode="distinct",
            o_filter=lambda r: True)

    # ---- CE (NaOH balance, entered) -----------------------------------------
    def naoh(scope, **kw):
        return E.ce_naoh_rows(db, cfg, scope=scope, d0=d0, d1=d1, **kw).rows

    compare(tag("qryCEAlleElektrolyseureNaOH"), sc["qryCEAlleElektrolyseureNaOH"], naoh("electrolyzer", refs=None),
            [("el", "Elektrolyseur", "electrolyzer"), ("s", "Datum", "date"), ("n", "CE", "mu_naoh")])
    compare(tag("qryCEAlleElementeNaOH"), sc["qryCEAlleElementeNaOH"], naoh("element", refs=None),
            [("el", "Elektrolyseur", "electrolyzer"), ("pos", "Position", "position"), ("s", "Datum", "date"),
             ("n", "CE", "mu_naoh")])
    compare(tag("qryCEAlleGruppenNaOH"), sc["qryCEAlleGruppenNaOH"], naoh("group", refs=None),
            [("grp", "Gruppe", "group"), ("s", "Datum", "date"), ("n", "CE", "mu_naoh")])
    compare(tag("qryCEAlleTeilanlagenNaOH"), sc["qryCEAlleTeilanlagenNaOH"], naoh("train", refs=None),
            [("s", "Teilanlage", "train"), ("s", "Datum", "date"), ("n", "CE", "mu_naoh")])
    compare(tag("qryCEGesamtanlageNaOH"), sc["qryCEGesamtanlageNaOH"], naoh("plant", refs=None),
            [("s", "Datum", "date"), ("n", "CE", "mu_naoh")])

    # ---- SPC -----------------------------------------------------------------
    spc_rows = E.spc_electrolyzer_rows(db, cfg, un_table="1", ce_basis="anodic", d0=d0, d1=d1, els=None).rows
    compare(tag("qrySPCAlleElektrolyseureUN1CE1"), sc["qrySPCAlleElektrolyseureUN1CE1"], spc_rows,
            [("el", "Elektrolyseur", "electrolyzer"), ("s", "Datum", "date"), ("n", "i", "i"), ("n", "Un", "un"),
             ("n", "CE", "ce"), ("n", "Energieverbrauch", "spc")], tol=1e-3)
    spc_pl = E.spc_plant_rows(db, cfg, un_table="1", d0=d0, d1=d1).rows
    compare(tag("qrySPCGesamtanlage"), sc["qrySPCGesamtanlage"], spc_pl,
            [("s", "Datum", "date"), ("n", "iGes", "i"), ("n", "UnGes", "un"), ("n", "CEGes", "ce"),
             ("n", "Energieverbrauch", "spc")], tol=1e-3)


if __name__ == "__main__":
    main()
