"""Dump remaining Access menu forms that the first pass missed."""
from __future__ import annotations

import json
from pathlib import Path

import win32com.client

MDB_COPY = Path(__file__).resolve().parent / "_tmp_pvc_arvand.mdb"
OUT = Path(__file__).resolve().parent / "access_more_forms.json"

EXTRA = [
    "frmZellenverwaltung",
    "Suchübersicht",
    "Gesamt Normierung",
    "Gesamt Norm >90",
    "Datenerfassung Elektrolyseure",
    "Datenerfassung Elemente",
    "Einzelteile",
    "Gruppen",
    "Gruppenmerkmale",
    "Gruppen Übersicht",
    "frmEinstellungen",
    "frmAnordnung",
    "frmMontagedaten",
    "frmEingabeUnElement",
    "frmEingabeUnGruppe",
    "frmMembranstatistik",
]


def dump_control(c) -> dict:
    item = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr in ("Caption", "ControlSource", "SourceObject"):
        try:
            val = getattr(c, attr, None)
            if val:
                item[attr.lower()] = str(val)[:400]
        except Exception:
            pass
    for attr in ("Left", "Top", "Width", "Height"):
        try:
            item[attr.lower()] = int(getattr(c, attr))
        except Exception:
            pass
    return item


def main() -> None:
    acc = win32com.client.DispatchEx("Access.Application")
    out: dict = {"forms": {}, "ce_like": []}
    try:
        acc.OpenCurrentDatabase(str(MDB_COPY), False)
        all_forms = [acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)]
        out["ce_like"] = [n for n in all_forms if "ce" in n.lower() or "strom" in n.lower() or "current" in n.lower()]
        wanted = EXTRA + [n for n in all_forms if n.lower().startswith("frmmenu") or "auswahl" in n.lower()]
        for fn in wanted:
            try:
                acc.DoCmd.OpenForm(fn, 1)
                frm = acc.Forms(fn)
                controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                layout = {"found": True, "controls": []}
                try:
                    layout["caption"] = str(frm.Caption or "")
                except Exception:
                    pass
                for c in controls:
                    cap = c.get("caption") or c.get("sourceobject") or ""
                    if cap or c.get("type") in (104, 105, 106, 109, 110, 100):
                        layout["controls"].append(c)
                acc.DoCmd.Close(2, fn)
            except Exception as exc:
                layout = {"found": False, "error": str(exc)}
            out["forms"][fn] = layout
        acc.CloseCurrentDatabase()
    finally:
        try:
            acc.Quit()
        except Exception:
            pass
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT, "forms", len(out["forms"]), "ce_like", out["ce_like"])


if __name__ == "__main__":
    main()
