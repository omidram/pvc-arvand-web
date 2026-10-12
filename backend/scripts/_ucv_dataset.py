"""Deterministic synthetic Un / CE data set shared by the Access oracle and the web check.

Pure python (no third-party imports) so it runs in both the system python (Access COM) and the
app venv. Electrolyzer names: Access ``1A`` == web ``A1``.
"""
from __future__ import annotations

import random
from datetime import date

ELS = [("1A", "A1"), ("1B", "B1"), ("2A", "A2")]
DATES = [date(2016, 6, d) for d in range(1, 6)]
TIMES = ["06:00", "14:00"]
NELEM = 24


def group_of(pos: int) -> int:
    return 1 if pos <= 8 else 2 if pos <= 16 else 3


def build(seed: int = 7) -> dict:
    rnd = random.Random(seed)
    nr = 1000
    slots = []
    for acc_el, web_el in ELS:
        for d in DATES:
            for t in TIMES:
                nr += 1
                readings = []
                for pos in range(1, NELEM + 1):
                    ui = round(rnd.uniform(2.95, 3.45), 3)
                    if rnd.random() < 0.06:
                        ui = round(rnd.uniform(0.0, 0.15), 3)  # below Umin 0.2 -> must be ignored
                    readings.append({"pos": pos, "ui": ui})
                valid = [r["ui"] for r in readings if r["ui"] > 0.2]
                slot = {
                    "nr": nr,
                    "acc_el": acc_el,
                    "web_el": web_el,
                    "date": d,
                    "time": t,
                    "I": round(rnd.uniform(11.0, 16.5), 2),
                    "Cc": round(rnd.uniform(30.0, 33.0), 1),
                    "tAn": round(rnd.uniform(80.0, 90.0), 1),
                    "tKa": round(rnd.uniform(80.0, 90.0), 1),
                    "Uo": 2.4,  # constant: Access qryUnTeilanlage2 GROUPs BY Uo, a varying Uo would split days
                    "UG": round(NELEM * (sum(valid) / len(valid)) + rnd.uniform(-1.5, 1.5), 2),
                    "n": NELEM,
                    "readings": readings,
                }
                slots.append(slot)
    # Incomplete slots: Access / web must drop them from every Un query.
    slots[3]["I"] = None
    slots[7]["Cc"] = None
    slots[11]["tKa"] = None

    montage = []
    for acc_el, web_el in ELS:
        for pos in range(1, NELEM + 1):
            row = {
                "acc_el": acc_el,
                "web_el": web_el,
                "pos": pos,
                "group": group_of(pos),
                "membrane": "F-8020" if group_of(pos) == 1 else "N-2030",
                "gap": "3.0",
                "start": date(2016, 5, 1) if pos < 20 else date(2016, 6, 3),
                "end": None,
            }
            montage.append(row)
    # An element replaced on 1B: old row switched off, a new one (other group) active from 06-03.
    for row in montage:
        if row["acc_el"] == "1B" and row["pos"] in (9, 10):
            row["end"] = date(2016, 6, 2)
    for pos in (9, 10):
        montage.append(
            {
                "acc_el": "1B",
                "web_el": "B1",
                "pos": pos,
                "group": 3,
                "membrane": "N-2030",
                "gap": "3.0",
                "start": date(2016, 6, 3),
                "end": None,
            }
        )

    groups = [
        {"group": 1, "anode": "denora", "cathode": "denora", "membrane": "F-8020", "gap": "3.0"},
        {"group": 2, "anode": "2", "cathode": "3", "membrane": "N-2030", "gap": "3.0"},
        {"group": 3, "anode": "x", "cathode": "y", "membrane": "N-2030", "gap": "3.0"},
    ]

    un_elements = []
    for acc_el, web_el, pos in (("1A", "A1", 5), ("1A", "A1", 6), ("2A", "A2", 7)):
        for d in DATES:
            un_elements.append(
                {
                    "acc_el": acc_el,
                    "web_el": web_el,
                    "pos": pos,
                    "date": d,
                    "time": "09:00",
                    "I": round(rnd.uniform(12.0, 16.0), 2),
                    "Cc": round(rnd.uniform(30.0, 33.0), 1),
                    "tAn": round(rnd.uniform(80.0, 90.0), 1),
                    "tKa": round(rnd.uniform(80.0, 90.0), 1),
                    "U": round(rnd.uniform(3.0, 3.4), 3),
                }
            )
    un_elements[2]["Cc"] = None

    un_groups = []
    for g in (1, 2):
        for d in DATES:
            un_groups.append(
                {
                    "group": g,
                    "date": d,
                    "time": "09:00",
                    "I": round(rnd.uniform(12.0, 16.0), 2),
                    "Cc": round(rnd.uniform(30.0, 33.0), 1),
                    "tAn": round(rnd.uniform(80.0, 90.0), 1),
                    "tKa": round(rnd.uniform(80.0, 90.0), 1),
                    "UG": round(NELEM * rnd.uniform(3.0, 3.4), 2),
                    "n": NELEM,
                }
            )
    un_groups.append(
        {"group": 3, "date": DATES[0], "time": "09:00", "I": 13.0, "Cc": 31.0, "tAn": 85.0, "tKa": 86.0, "UG": 77.0, "n": None}
    )

    def anolyte():
        return {
            "NaClO3 An": round(rnd.uniform(6.0, 12.0), 3),
            "Na2SO4 An": round(rnd.uniform(8.0, 12.0), 3),
            "NaOCl An": round(rnd.uniform(0.5, 3.0), 3),
            "HCl An": round(rnd.uniform(0.1, 1.0), 3),
        }

    def brine():
        return {
            "flow rate": round(rnd.uniform(28.0, 36.0), 2),
            "NaClO3 Pb": round(rnd.uniform(0.5, 1.0), 3),
            "Na2SO4 Pb": round(rnd.uniform(4.0, 6.0), 3),
            "NaOH Pb": round(rnd.uniform(0.0, 0.5), 3),
            "Na2CO3 Pb": round(rnd.uniform(0.0, 0.3), 3),
            "HCl Pb": round(rnd.uniform(1.0, 2.0), 3),
        }

    def chlorine():
        return {"Cl2 + CO2 Cl": round(rnd.uniform(96.0, 98.0), 2), "O2 Cl": round(rnd.uniform(1.0, 3.0), 2)}

    # keys: electrolyzer scope (acc_el, web_el, date), group scope (group, date), element scope (acc_el, web_el, pos, date)
    an_el, pb_el, cl_el = [], [], []
    for acc_el, web_el in ELS:
        for d in DATES:
            base = {"acc_el": acc_el, "web_el": web_el, "date": d}
            an_el.append({**base, "time": "08:00", **anolyte()})
            pb_el.append({**base, "time": "08:00", **brine()})
            cl_el.append({**base, "time": "08:00", **chlorine()})
    # edge cases the Access joins treat in a specific way
    pb_el = [r for r in pb_el if not (r["acc_el"] == "1B" and r["date"] == DATES[2])]  # no pure brine
    cl_el = [r for r in cl_el if not (r["acc_el"] == "2A" and r["date"] == DATES[1])]  # no chlorine gas
    for r in an_el:
        if r["acc_el"] == "1B" and r["date"] == DATES[4]:
            r["NaOCl An"] = None
        if r["acc_el"] == "2A" and r["date"] == DATES[0]:
            r["Na2SO4 An"] = 0.0 + 9.1

    an_gr, pb_gr, cl_gr = [], [], []
    for g in (1, 2):
        for d in DATES:
            base = {"group": g, "date": d, "time": "08:00"}
            an_gr.append({**base, **anolyte()})
            pb_gr.append({**base, **brine()})
            cl_gr.append({**base, **chlorine()})
    cl_gr = [r for r in cl_gr if not (r["group"] == 2 and r["date"] == DATES[1])]

    an_em, pb_em, cl_em = [], [], []
    for acc_el, web_el, pos in (("1A", "A1", 5), ("2A", "A2", 7)):
        for d in DATES:
            base = {"acc_el": acc_el, "web_el": web_el, "pos": pos, "date": d, "time": "08:00"}
            an_em.append({**base, **anolyte()})
            pb_em.append({**base, **brine()})
            cl_em.append({**base, **chlorine()})

    ce_naoh = {
        "electrolyzer": [{"acc_el": a, "web_el": w, "date": d, "ce": round(rnd.uniform(93.0, 97.0), 2)} for a, w in ELS[:2] for d in DATES],
        "element": [
            {"acc_el": "1A", "web_el": "A1", "pos": 5, "date": d, "time": "09:00", "ce": round(rnd.uniform(93.0, 97.0), 2)} for d in DATES
        ],
        "group": [{"group": 1, "date": d, "ce": round(rnd.uniform(93.0, 97.0), 2)} for d in DATES],
        "train": [{"train": "1", "date": d, "ce": round(rnd.uniform(93.0, 97.0), 2)} for d in DATES],
        "plant": [{"date": d, "ce": round(rnd.uniform(93.0, 97.0), 2)} for d in DATES],
    }

    return {
        "slots": slots,
        "montage": montage,
        "groups": groups,
        "un_elements": un_elements,
        "un_groups": un_groups,
        "an_el": an_el,
        "pb_el": pb_el,
        "cl_el": cl_el,
        "an_gr": an_gr,
        "pb_gr": pb_gr,
        "cl_gr": cl_gr,
        "an_em": an_em,
        "pb_em": pb_em,
        "cl_em": cl_em,
        "ce_naoh": ce_naoh,
    }


# Settings scenarios (Access tblGewDaten values -> web UnCeSettings/PlantSettings).
SCENARIOS = {
    "default": {
        "IDiRef": 6, "Flaeche": 2.72, "Umin": 0.2, "AnodischerKorrekturfaktor": 0.0,
        "IDClOAnalyse": 2, "IDAnsaeurung": 1, "IDTemperaturkorrekturElement": 2,
    },
    "variant": {
        "IDiRef": 4, "Flaeche": 2.72, "Umin": 3.0, "AnodischerKorrekturfaktor": 0.05,
        "IDClOAnalyse": 1, "IDAnsaeurung": 2, "IDTemperaturkorrekturElement": 1,
    },
}
IREF_BY_ID = {1: 3.0, 4: 4.0, 5: 5.0, 6: 6.0}
