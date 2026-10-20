"""Dump Access anode/cathode detail and related form layouts."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_electrode.mdb"
OUT = Path(__file__).resolve().parent / "_electrode_forms.json"

WANTED = [
    "frmAnodendetails",
    "frmKathodendetails",
    "frmAnodeninstandhaltung",
    "frmKathodeninstandhaltung",
    "frmAnodenrecoating",
    "frmKathodenrecoating",
    "frmAnodencoatingpruefung",
    "frmKathodencoatingpruefung",
    "subfrmAnodeninstandhaltung",
    "subfrmKathodeninstandhaltung",
    "subfrmAnodenrecoating",
    "subfrmKathodenrecoating",
    "subfrmAnodencoatingpruefung",
    "subfrmKathodencoatingpruefung",
]


def dump_control(c) -> dict:
    item = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr in ("Caption", "ControlSource", "RowSource", "SourceObject", "LinkMasterFields", "LinkChildFields"):
        try:
            val = getattr(c, attr, None)
            if val:
                item[attr.lower()] = str(val)[:500]
        except Exception:
            pass
    for attr in ("Left", "Top", "Width", "Height"):
        try:
            item[attr.lower()] = int(getattr(c, attr))
        except Exception:
            pass
    return item


def main() -> None:
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    out: dict = {}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        names = {acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)}
        for fn in WANTED:
            if fn not in names:
                out[fn] = {"found": False}
                continue
            try:
                acc.DoCmd.OpenForm(fn, 1)
                frm = acc.Forms(fn)
                controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                layout = {"found": True, "recordsource": "", "caption": "", "controls": controls}
                try:
                    layout["caption"] = str(frm.Caption or "")
                except Exception:
                    pass
                try:
                    layout["recordsource"] = str(frm.RecordSource or "")[:800]
                except Exception:
                    pass
                acc.DoCmd.Close(2, fn)
            except Exception as exc:
                layout = {"found": False, "error": str(exc)}
            out[fn] = layout
        acc.CloseCurrentDatabase()
    finally:
        acc.Quit()
        if COPY.exists():
            COPY.unlink()
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", OUT)


if __name__ == "__main__":
    main()
