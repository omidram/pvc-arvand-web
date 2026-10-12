"""Run the synthetic data set through the REAL Access queries (the oracle).

Copies the mdb, replaces the Un/CE related data with ``_ucv_dataset.build()``, switches the
tblGewDaten settings per scenario, executes every relevant Access query through DAO and dumps
the result rows to ``_ucv_oracle.json``. Run with the system python (needs win32com):

    C:\\Python312\\python.exe backend/scripts/_ucv_access_oracle.py
"""
from __future__ import annotations

import json
import shutil
import sys
from datetime import date, datetime
from pathlib import Path

import win32com.client

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _ucv_dataset as ds  # noqa: E402

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_oracle.mdb"
OUT = Path(__file__).resolve().parent / "_ucv_oracle.json"

QUERIES = [
    "qryUnElektrolyseur", "qryUnAlleElektrolyseure", "qryUnElektrolyseure",
    "qryUnElektrolyseur2", "qryUnAlleElektrolyseure2", "qryUnElektrolyseure2",
    "qryUnGesamtanlage", "qryUnGesamtanlage2",
    "qryUnTeilanlage", "qryUnAlleTeilanlagen", "qryUnTeilanlage2", "qryUnAlleTeilanlagen2",
    "qryUnElement", "qryUnElemente", "qryUnElement2", "qryUnElemente2", "qryUnAlleElemente2",
    "UnGruppen", "ListGr2", "qryUnMehrereGruppen", "qryUnGruppe2", "qryUnAlleGruppen2",
    "qryCEAlleElektrolyseure", "qryCEElektrolyseur",
    "qryCETeilanlage", "qryCEAlleTeilanlagen", "qryCEGesamtanlage",
    "qryCEAlleGruppen", "qryCEGruppe", "qryCEAlleElemente", "qryCEElement",
    "qryCEAlleElektrolyseureNaOH", "qryCEAlleElementeNaOH", "qryCEAlleGruppenNaOH",
    "qryCEAlleTeilanlagenNaOH", "qryCEGesamtanlageNaOH",
    "qrySPCAlleElektrolyseureUN1CE1", "qrySPCGesamtanlage",
]


def d(v: date) -> str:
    return f"#{v.isoformat()}#"


def t(v: str) -> str:
    return f"#{v}:00#"


def n(v) -> str:
    return "Null" if v is None else repr(v) if not isinstance(v, str) else f"'{v}'"


def conv(v):
    if isinstance(v, datetime):
        if v.year <= 1900:
            return v.strftime("%H:%M")
        return v.date().isoformat() if v.hour == 0 and v.minute == 0 else v.isoformat()
    return v


def main() -> None:
    data = ds.build()
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.gencache.EnsureDispatch("Access.Application")
    try:
        acc.AutomationSecurity = 1  # msoAutomationSecurityLow: let the VBA module run
    except Exception as exc:  # noqa: BLE001
        print("AutomationSecurity failed", exc)
    out: dict = {}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        db = acc.CurrentDb()

        def ex(sql: str) -> None:
            db.Execute(sql)

        for tbl in [
            "NormElek", "Normierung", "Spannungen", "Montage", "Gruppenmerkmale", "tblEingabeUnElement", "tblEingabeUnGruppe",
            "Analyse anolyt", "Analyse pure brine", "Analyse Chlorgas",
            "Analyse Anolyt Gruppe", "Analyse pure brine gruppe", "Analyse Chlorgas Gruppe",
            "Analyse Anolyt Element", "Analyse Pure Brine Element", "Analyse Chlorgas Element",
            "tblEingabeCEElektrolyseurNaOH", "tblEingabeCEElementNaOH", "tblEingabeCEGruppeNaOH",
            "tblEingabeCETeilanlageNaOH", "tblEingabeCEGesamtanlageNaOH",
            "tblGewElementeUnCeSpc", "tblGewGruppenUnCeSpc", "tblGewElektrolyseureUnCeSpc",
        ]:
            ex(f"DELETE FROM [{tbl}]")

        for s in data["slots"]:
            ex(
                "INSERT INTO NormElek (Normierung, Elektrolyseur, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], Uo, [U Gesamt], Elementzahl) "
                f"VALUES ({s['nr']}, '{s['acc_el']}', {d(s['date'])}, {t(s['time'])}, {n(s['I'])}, {n(s['Cc'])}, {n(s['tAn'])}, {n(s['tKa'])}, {n(s['Uo'])}, {n(s['UG'])}, {s['n']})"
            )
            ex(
                "INSERT INTO Normierung (Normierung, Elektrolyseur, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], Uo) "
                f"VALUES ({s['nr']}, '{s['acc_el']}', {d(s['date'])}, {t(s['time'])}, {n(s['I'])}, {n(s['Cc'])}, {n(s['tAn'])}, {n(s['tKa'])}, {n(s['Uo'])})"
            )
            for r in s["readings"]:
                ex(
                    "INSERT INTO Spannungen (Normierung, Elektrolyseur, Position, Datum, Zeit, Ui) "
                    f"VALUES ({s['nr']}, '{s['acc_el']}', {r['pos']}, {d(s['date'])}, {t(s['time'])}, {r['ui']})"
                )
        for m in data["montage"]:
            ex(
                "INSERT INTO Montage ([Element Nr], Membrantyp, [Elektroden Abstand], Elektrolyseur, Position, [Einschalt Datum], [Ausschalt Datum], Gruppe) "
                f"VALUES ({m['pos'] + 1000 * ord(m['acc_el'][1])}, '{m['membrane']}', {m['gap']}, '{m['acc_el']}', {m['pos']}, {d(m['start'])}, "
                f"{'Null' if m['end'] is None else d(m['end'])}, {m['group']})"
            )
        for g in data["groups"]:
            ex(
                "INSERT INTO Gruppenmerkmale (Gruppe, Anodencoating, Kathodencoating, Membrantyp, Elektrodenabstand) "
                f"VALUES ({g['group']}, '{g['anode']}', '{g['cathode']}', '{g['membrane']}', {g['gap']})"
            )
        for e in data["un_elements"]:
            ex(
                "INSERT INTO tblEingabeUnElement (Elektrolyseur, Position, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], U) "
                f"VALUES ('{e['acc_el']}', {e['pos']}, {d(e['date'])}, {t(e['time'])}, {n(e['I'])}, {n(e['Cc'])}, {n(e['tAn'])}, {n(e['tKa'])}, {n(e['U'])})"
            )
        for g in data["un_groups"]:
            ex(
                "INSERT INTO tblEingabeUnGruppe (Gruppe, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], [U Gesamt], n) "
                f"VALUES ({g['group']}, {d(g['date'])}, {t(g['time'])}, {n(g['I'])}, {n(g['Cc'])}, {n(g['tAn'])}, {n(g['tKa'])}, {n(g['UG'])}, {n(g['n'])})"
            )

        def ins_an(table, rows, keys):
            for r in rows:
                cols, vals = [], []
                for ck, rk in keys:
                    cols.append(f"[{ck}]")
                    v = r[rk]
                    vals.append(d(v) if isinstance(v, date) else t(v) if rk == "time" else n(v))
                ex(f"INSERT INTO [{table}] ({', '.join(cols)}) VALUES ({', '.join(vals)})")

        an_keys = ["NaClO3 An", "Na2SO4 An", "NaOCl An", "HCl An"]
        pb_keys = ["flow rate", "NaClO3 Pb", "Na2SO4 Pb", "NaOH Pb", "Na2CO3 Pb", "HCl Pb"]
        cl_keys = ["Cl2 + CO2 Cl", "O2 Cl"]
        el_keys = [("Elektrolyseur", "acc_el"), ("Datum", "date"), ("Zeit", "time")]
        gr_keys = [("Gruppe", "group"), ("Datum", "date"), ("Zeit", "time")]
        em_keys = [("Elektrolyseur", "acc_el"), ("Position", "pos"), ("Datum", "date"), ("Zeit", "time")]
        ins_an("Analyse anolyt", data["an_el"], el_keys + [(k, k) for k in an_keys])
        ins_an("Analyse pure brine", data["pb_el"], el_keys + [(k, k) for k in pb_keys])
        ins_an("Analyse Chlorgas", data["cl_el"], el_keys + [(k, k) for k in cl_keys])
        ins_an("Analyse Anolyt Gruppe", data["an_gr"], gr_keys + [(k, k) for k in an_keys])
        ins_an("Analyse pure brine gruppe", data["pb_gr"], gr_keys + [(k, k) for k in pb_keys])
        ins_an("Analyse Chlorgas Gruppe", data["cl_gr"], gr_keys + [(k, k) for k in cl_keys])
        ins_an("Analyse Anolyt Element", data["an_em"], em_keys + [(k, k) for k in an_keys])
        ins_an("Analyse Pure Brine Element", data["pb_em"], em_keys + [(k, k) for k in pb_keys])
        ins_an("Analyse Chlorgas Element", data["cl_em"], em_keys + [(k, k) for k in cl_keys])

        nh = data["ce_naoh"]
        for r in nh["electrolyzer"]:
            ex(f"INSERT INTO tblEingabeCEElektrolyseurNaOH (Datum, Elektrolyseur, CE) VALUES ({d(r['date'])}, '{r['acc_el']}', {r['ce']})")
        for r in nh["element"]:
            ex(f"INSERT INTO tblEingabeCEElementNaOH (Datum, Zeit, Elektrolyseur, Position, CE) VALUES ({d(r['date'])}, {t(r['time'])}, '{r['acc_el']}', {r['pos']}, {r['ce']})")
        for r in nh["group"]:
            ex(f"INSERT INTO tblEingabeCEGruppeNaOH (Datum, Gruppe, CE) VALUES ({d(r['date'])}, {r['group']}, {r['ce']})")
        for r in nh["train"]:
            ex(f"INSERT INTO tblEingabeCETeilanlageNaOH (Datum, Teilanlage, CE) VALUES ({d(r['date'])}, '{r['train']}', {r['ce']})")
        for r in nh["plant"]:
            ex(f"INSERT INTO tblEingabeCEGesamtanlageNaOH (Datum, CE) VALUES ({d(r['date'])}, {r['ce']})")

        ex("INSERT INTO tblGewElementeUnCeSpc (Bezeichnung, Position) VALUES ('1A', 5)")
        ex("INSERT INTO tblGewElementeUnCeSpc (Bezeichnung, Position) VALUES ('2A', 7)")
        ex("INSERT INTO tblGewGruppenUnCeSpc (Bezeichnung) VALUES (1)")
        ex("INSERT INTO tblGewGruppenUnCeSpc (Bezeichnung) VALUES (2)")
        ex("INSERT INTO tblGewElektrolyseureUnCeSpc (Bezeichnung) VALUES ('1A')")
        ex("INSERT INTO tblGewElektrolyseureUnCeSpc (Bezeichnung) VALUES ('1B')")

        arr = db.OpenRecordset("SELECT Bezeichnung, Teilanlage FROM tblElektrolyseuranordnung")
        mapping = {}
        while not arr.EOF:
            mapping[arr.Fields("Bezeichnung").Value] = arr.Fields("Teilanlage").Value
            arr.MoveNext()
        arr.Close()
        out["arrangement"] = mapping

        sel = {
            "Anfangsdatum": "#2016-05-31#", "Enddatum": "#2016-06-06#",
            "IDElektrolyseurUnCeSpcElektrolyseur": 9, "IDElektrolyseurUnCeSpcElement": 9, "IDPositionUnCeSpcElement": 5,
            "IDGruppeUnCeSpcGruppe": 1, "IDGruppe": 1, "IDTeilanlageUnCeSpcTeilanlage": 1, "IDTeilanlageCETeilanlage": 1,
        }
        out["scenarios"] = {}
        for name, cfg in ds.SCENARIOS.items():
            sets = {**sel, **cfg}
            for field, value in sets.items():
                try:
                    ex(f"UPDATE tblGewDaten SET [{field}] = {value}")
                except Exception as exc:  # noqa: BLE001
                    print("UPDATE failed", field, exc)
            acc.Run("KorrekturfaktorenAktualisieren")
            print("scenario", name, "iRef", acc.Run("GetGewIRef"), "tK", acc.Run("GetGewtKorrektur"), "cK", acc.Run("GetGewcKorrektur"))
            res = {}
            for q in QUERIES:
                try:
                    rs = db.OpenRecordset(q)
                    names = [rs.Fields(i).Name for i in range(rs.Fields.Count)]
                    rows = []
                    while not rs.EOF:
                        rows.append({nm: conv(rs.Fields(nm).Value) for nm in names})
                        rs.MoveNext()
                    rs.Close()
                    res[q] = rows
                    print(f"  {q}: {len(rows)} rows")
                except Exception as exc:  # noqa: BLE001
                    res[q] = {"error": str(exc)[:300]}
                    print(f"  {q}: ERROR {str(exc)[:160]}")
            out["scenarios"][name] = res
    finally:
        try:
            acc.CloseCurrentDatabase()
        except Exception:  # noqa: BLE001
            pass
        acc.Quit()
        if COPY.exists():
            try:
                COPY.unlink()
            except OSError:
                pass
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
