"""Dump Access analysis form layouts (labels + bound fields) from the plant MDB."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_analysis.mdb"
OUT = Path(__file__).resolve().parent / "_analysis_forms.json"

KEYS = (
    "analys",
    "anolyt",
    "catholyt",
    "brine",
    "chlor",
    "hydrogen",
    "wasserstoff",
    "demin",
    "caustic",
    "hcl",
    "sole",
    "lauge",
)


def dump_control(c) -> dict:
    item = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr in ("Caption", "ControlSource", "RowSource"):
        try:
            val = getattr(c, attr, None)
            if val:
                item[attr.lower()] = str(val)[:300]
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
    out: dict = {"forms": {}, "tables": {}}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        names = [acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)]
        wanted = [n for n in names if any(k in n.lower() for k in KEYS)]
        out["form_names"] = wanted
        for fn in wanted:
            try:
                acc.DoCmd.OpenForm(fn, 1)  # design view: all labels and bound fields
                frm = acc.Forms(fn)
                controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                layout = {"found": True, "controls": controls, "record_source": ""}
                try:
                    layout["caption"] = str(frm.Caption or "")
                except Exception:
                    layout["caption"] = ""
                try:
                    layout["record_source"] = str(frm.RecordSource or "")[:400]
                except Exception:
                    pass
                try:
                    layout["default_view"] = int(frm.DefaultView)
                except Exception:
                    pass
                acc.DoCmd.Close(2, fn)
            except Exception as exc:
                layout = {"found": False, "error": str(exc)}
            out["forms"][fn] = layout

        db = acc.CurrentDb()
        for i in range(db.TableDefs.Count):
            td = db.TableDefs(i)
            name = str(td.Name)
            if name.startswith("MSys") or name.startswith("~"):
                continue
            low = name.lower()
            if not any(k in low for k in ("analys", "anolyt", "catholyt", "brine", "chlor", "hydrogen", "hcl", "caustic", "demin")):
                continue
            fields = []
            for j in range(td.Fields.Count):
                f = td.Fields(j)
                fields.append({"name": str(f.Name), "type": int(f.Type)})
            out["tables"][name] = fields
        acc.CloseCurrentDatabase()
    finally:
        acc.Quit()
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"forms {len(out.get('forms', {}))} tables {len(out.get('tables', {}))} -> {OUT}")


if __name__ == "__main__":
    main()
