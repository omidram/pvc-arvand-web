"""One-off: dump Access forms, reports, tables, relationships, form layouts."""
from __future__ import annotations

import json
from pathlib import Path

MDB = r"c:\Users\Omid\Downloads\New folder (4)\PVC_Arvand_kofigurierte Datenbank.mdb"
OUT = Path(__file__).resolve().parent / "access_meta_dump.json"


def main() -> None:
    out: dict = {"mdb_path": MDB, "mdb_exists": Path(MDB).is_file(), "methods": {}}

    try:
        import pyodbc

        conn_str = r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ=" + MDB
        conn = pyodbc.connect(conn_str)
        cur = conn.cursor()
        tables = sorted(
            r.table_name
            for r in cur.tables(tableType="TABLE")
            if not r.table_name.startswith("MSys")
        )
        cur.execute("SELECT Name, Type FROM MSysObjects WHERE Type IN (-32768, -32764) ORDER BY Name")
        objs = cur.fetchall()
        form_names = sorted(r[0] for r in objs if r[1] == -32768)
        report_names = sorted(r[0] for r in objs if r[1] == -32764)
        join_info: list | dict = []
        try:
            cur.execute(
                "SELECT szRelationship, szColumn, szReferencedColumn, szTable, szReferencedTable "
                "FROM MSysRelationships ORDER BY szTable, szRelationship"
            )
            for row in cur.fetchall():
                join_info.append(
                    {
                        "relationship": row[0],
                        "child_column": row[1],
                        "parent_column": row[2],
                        "child_table": row[3],
                        "parent_table": row[4],
                    }
                )
        except Exception as exc:  # noqa: BLE001
            join_info = {"error": str(exc)}
        out["methods"]["pyodbc"] = {
            "ok": True,
            "table_count": len(tables),
            "tables": tables,
            "form_count": len(form_names),
            "forms": form_names,
            "report_count": len(report_names),
            "reports": report_names,
            "relationships": join_info,
        }
        conn.close()
    except Exception as exc:  # noqa: BLE001
        out["methods"]["pyodbc"] = {"ok": False, "error": str(exc)}

    target_forms = [
        "Element Administration",
        "Cell Arrangement",
        "Search",
        "Standardized Voltage",
        "Current Efficiency",
        "Analysis",
        "Statistics",
        "Shut Down",
        "Remarks",
        "Settings",
        "Anodes",
        "Cathodes",
        "Membranes",
        "Inspections",
    ]
    try:
        import win32com.client

        acc = win32com.client.Dispatch("Access.Application")
        try:
            acc.UserControl = False
        except Exception:
            pass
        acc.OpenCurrentDatabase(MDB, False)
        all_forms = sorted(
            acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)
        )
        form_layouts: dict = {}
        for fn in target_forms:
            layout: dict = {"found": False, "tried": []}
            candidates = [fn]
            if fn == "Shut Down":
                candidates += ["ShutDown", "Abschaltungen"]
            for candidate in candidates:
                layout["tried"].append(candidate)
                try:
                    acc.DoCmd.OpenForm(candidate, 1)  # acDesign
                    frm = acc.Forms(candidate)
                    controls = []
                    for i in range(frm.Controls.Count):
                        c = frm.Controls(i)
                        item: dict = {"name": c.Name, "type": c.ControlType}
                        try:
                            if c.Caption:
                                item["caption"] = str(c.Caption)
                        except Exception:
                            pass
                        try:
                            if c.ControlSource:
                                item["control_source"] = str(c.ControlSource)
                        except Exception:
                            pass
                        try:
                            if c.ControlType == 112:
                                item["subform"] = str(c.SourceObject)
                        except Exception:
                            pass
                        controls.append(item)
                    acc.DoCmd.Close(2, candidate)
                    layout = {
                        "found": True,
                        "access_name": candidate,
                        "control_count": len(controls),
                        "controls": controls,
                    }
                    break
                except Exception as ex:  # noqa: BLE001
                    layout["last_error"] = str(ex)
            form_layouts[fn] = layout
        out["methods"]["win32com"] = {
            "ok": True,
            "all_forms": all_forms,
            "target_layouts": form_layouts,
        }
        acc.CloseCurrentDatabase()
        acc.Quit()
    except Exception as exc:  # noqa: BLE001
        out["methods"]["win32com"] = {"ok": False, "error": str(exc)}

    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")
    print(json.dumps({k: v for k, v in out.items() if k != "methods"}, indent=2))
    for method, data in out["methods"].items():
        if data.get("ok"):
            print(f"{method}: OK")
            if method == "pyodbc":
                print(f"  tables={data['table_count']} forms={data['form_count']} reports={data['report_count']}")
            if method == "win32com":
                print(f"  all_forms={len(data.get('all_forms', []))}")
        else:
            print(f"{method}: FAILED - {data.get('error')}")


if __name__ == "__main__":
    main()
