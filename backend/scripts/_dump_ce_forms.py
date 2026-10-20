"""Dump Access Current Efficiency data-input forms/tables from the plant MDB."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_ce.mdb"
OUT = Path(__file__).resolve().parent / "_ce_forms.json"

FORM_KEYS = (
    "eingabece",
    "tabelleeingabece",
    "unce",
    "stromausbeute",
)
TABLE_KEYS = (
    "eingabece",
    "ceelement",
    "ceelektrolyseur",
    "ceteilanlage",
    "cegesamt",
    "cegruppe",
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
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    out: dict = {"forms": {}, "tables": {}, "sample_rows": {}}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        names = [acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)]
        wanted = [n for n in names if any(k in n.lower() for k in FORM_KEYS) or "EingabeCE" in n or "CE" in n and "Eingabe" in n]
        # Prefer explicit EingabeCE forms first, also hub UnCE
        wanted = sorted(set(wanted))
        out["form_names"] = wanted
        for fn in wanted:
            try:
                acc.DoCmd.OpenForm(fn, 1)
                frm = acc.Forms(fn)
                controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                layout = {"found": True, "controls": controls, "record_source": ""}
                try:
                    layout["caption"] = str(frm.Caption or "")
                except Exception:
                    layout["caption"] = ""
                try:
                    layout["record_source"] = str(frm.RecordSource or "")[:800]
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
        table_names = []
        for i in range(db.TableDefs.Count):
            td = db.TableDefs(i)
            name = str(td.Name)
            if name.startswith("MSys") or name.startswith("~"):
                continue
            low = name.lower()
            if any(k in low for k in TABLE_KEYS) or "ce" in low and "eingabe" in low:
                table_names.append(name)
        out["table_names"] = table_names
        for name in table_names:
            td = db.TableDefs(name)
            fields = []
            for j in range(td.Fields.Count):
                f = td.Fields(j)
                fields.append({"name": str(f.Name), "type": int(f.Type), "size": int(f.Size)})
            out["tables"][name] = fields
            try:
                rs = db.OpenRecordset(f"SELECT TOP 5 * FROM [{name}]")
                rows = []
                while not rs.EOF and len(rows) < 5:
                    row = {}
                    for j in range(rs.Fields.Count):
                        fld = rs.Fields(j)
                        try:
                            row[str(fld.Name)] = None if fld.Value is None else str(fld.Value)[:120]
                        except Exception:
                            row[str(fld.Name)] = "<err>"
                    rows.append(row)
                    rs.MoveNext()
                rs.Close()
                out["sample_rows"][name] = rows
            except Exception as exc:
                out["sample_rows"][name] = {"error": str(exc)}

        # Also dump UnCE hub form if present under exact names
        for hub in ("UnCE", "Current", "frmMenuCE"):
            if hub in names and hub not in out["forms"]:
                try:
                    acc.DoCmd.OpenForm(hub, 1)
                    frm = acc.Forms(hub)
                    controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                    out["forms"][hub] = {
                        "found": True,
                        "caption": str(getattr(frm, "Caption", "") or ""),
                        "record_source": str(getattr(frm, "RecordSource", "") or "")[:400],
                        "controls": controls,
                    }
                    acc.DoCmd.Close(2, hub)
                except Exception as exc:
                    out["forms"][hub] = {"found": False, "error": str(exc)}
    finally:
        try:
            acc.CloseCurrentDatabase()
        except Exception:
            pass
        try:
            acc.Quit()
        except Exception:
            pass
        if COPY.exists():
            try:
                COPY.unlink()
            except Exception:
                pass
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {OUT} forms={len(out['forms'])} tables={len(out['tables'])}")


if __name__ == "__main__":
    main()
