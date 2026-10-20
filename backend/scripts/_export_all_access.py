"""Export every Access object (forms, modules, queries, reports, macros) as text for auditing."""
from __future__ import annotations

import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
HERE = Path(__file__).resolve().parent
COPY = HERE / "_tmp_export.mdb"
OUT = HERE / "_vba_dump"

KINDS = {  # name -> (acObjectType, collection attr)
    "forms": 2,
    "modules": 5,
    "queries": 1,
    "reports": 3,
    "macros": 4,
}


def safe(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_ ." else "_" for c in name)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        proj = acc.CurrentProject
        colls = {
            "forms": proj.AllForms,
            "modules": proj.AllModules,
            "reports": proj.AllReports,
            "macros": proj.AllMacros,
        }
        for kind, coll in colls.items():
            d = OUT / kind
            d.mkdir(exist_ok=True)
            names = [coll.Item(i).Name for i in range(coll.Count)]
            print(kind, len(names))
            for n in names:
                try:
                    acc.SaveAsText(KINDS[kind], n, str(d / (safe(n) + ".txt")))
                except Exception as e:  # noqa: BLE001
                    print("  fail", kind, n, e)
        # queries via DAO
        d = OUT / "queries"
        d.mkdir(exist_ok=True)
        db = acc.CurrentDb()
        n = 0
        for qd in db.QueryDefs:
            if qd.Name.startswith("~"):
                continue
            (d / (safe(qd.Name) + ".sql")).write_text(qd.SQL or "", encoding="utf-8")
            n += 1
        print("queries", n)
        # tables: names and fields
        lines = []
        for td in db.TableDefs:
            if td.Name.startswith("MSys") or td.Name.startswith("~"):
                continue
            fields = ", ".join(f"{f.Name}:{f.Type}" for f in td.Fields)
            lines.append(f"{td.Name} [{td.RecordCount}] :: {fields}")
        (OUT / "tables.txt").write_text("\n".join(lines), encoding="utf-8")
        print("tables", len(lines))
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


if __name__ == "__main__":
    main()
