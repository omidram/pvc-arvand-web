"""Dump the Access group-definition / group-overview forms, tables, queries and VBA."""
from __future__ import annotations

import json
import shutil
import time
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_grp.mdb"
OUT = Path(__file__).resolve().parent / "_group_forms.json"

FORMS = ["Gruppenmerkmale", "Gruppen Übersicht", "Gruppen", "frmSucheGruppe", "subfrmSucheGruppe", "subfrmSuchergebnisGruppe"]
TABLES = ["Gruppenmerkmale", "Gruppierung"]
QUERIES = ["qryGruppe", "qryVerwendeteGruppen", "Gruppen aktiv", "UnGruppen"]


def control(c) -> dict:
    item = {"name": str(c.Name)}
    for attr in ("ControlType", "Left", "Top", "Width", "Height", "TabIndex"):
        try:
            item[attr.lower()] = int(getattr(c, attr))
        except Exception:
            pass
    for attr in ("Caption", "ControlSource", "RowSource", "RowSourceType", "SourceObject", "OnClick", "OnDblClick",
                 "AfterUpdate", "BeforeUpdate", "OnEnter", "OnChange", "DefaultValue", "ValidationRule",
                 "ValidationText", "LimitToList", "BoundColumn", "ColumnWidths", "OrderBy", "LinkMasterFields",
                 "LinkChildFields", "Visible", "Enabled", "Locked"):
        try:
            val = getattr(c, attr, None)
            if val not in (None, ""):
                item[attr.lower()] = str(val)[:600]
        except Exception:
            pass
    return item


def main() -> None:
    COPY.unlink(missing_ok=True)
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    out: dict = {"forms": {}, "tables": {}, "queries": {}}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        for fn in FORMS:
            try:
                acc.DoCmd.OpenForm(fn, 1)  # design view
                frm = acc.Forms(fn)
                entry = {"controls": [control(frm.Controls(i)) for i in range(frm.Controls.Count)]}
                for attr in ("Caption", "RecordSource", "OrderBy", "Filter", "DefaultView", "AllowAdditions", "AllowEdits",
                             "AllowDeletions", "OnOpen", "OnLoad", "OnCurrent", "BeforeUpdate", "AfterUpdate", "HasModule"):
                    try:
                        val = getattr(frm, attr, None)
                        if val not in (None, ""):
                            entry[attr] = str(val)[:1500]
                    except Exception:
                        pass
                try:
                    mod = frm.Module
                    entry["vba"] = mod.Lines(1, mod.CountOfLines) if mod.CountOfLines else ""
                except Exception as exc:
                    entry["vba_error"] = str(exc)
                acc.DoCmd.Close(2, fn, 2)
                out["forms"][fn] = entry
            except Exception as exc:
                out["forms"][fn] = {"error": str(exc)}
        db = acc.CurrentDb()
        for name in TABLES:
            try:
                td = db.TableDefs(name)
                fields = [{"name": str(td.Fields(j).Name), "type": int(td.Fields(j).Type), "size": int(td.Fields(j).Size)} for j in range(td.Fields.Count)]
                rs = db.OpenRecordset(f"SELECT * FROM [{name}]")
                rows = []
                while not rs.EOF and len(rows) < 300:
                    row = {}
                    for j in range(rs.Fields.Count):
                        try:
                            v = rs.Fields(j).Value
                            row[str(rs.Fields(j).Name)] = None if v is None else str(v)[:200]
                        except Exception:
                            row[str(rs.Fields(j).Name)] = "<err>"
                    rows.append(row)
                    rs.MoveNext()
                rs.Close()
                out["tables"][name] = {"fields": fields, "rows": rows}
            except Exception as exc:
                out["tables"][name] = {"error": str(exc)}
        for name in QUERIES:
            try:
                out["queries"][name] = str(db.QueryDefs(name).SQL)
            except Exception as exc:
                out["queries"][name] = f"error: {exc}"
    finally:
        try:
            acc.CloseCurrentDatabase()
        except Exception:
            pass
        try:
            acc.Quit()
        except Exception:
            pass
        time.sleep(2)
        try:
            COPY.unlink(missing_ok=True)
        except Exception:
            pass
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf-8")
    print("wrote", OUT, len(out["forms"]), "forms")


if __name__ == "__main__":
    main()
