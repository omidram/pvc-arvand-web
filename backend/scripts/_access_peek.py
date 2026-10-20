"""Print rows of small Access tables (read-only, from a copy). Usage: python _access_peek.py Table1 Table2 ..."""
from __future__ import annotations

import shutil
import sys
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_peek.mdb"


def main(tables: list[str]) -> None:
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        db = acc.CurrentDb()
        for t in tables:
            print("=====", t)
            try:
                rs = db.OpenRecordset(f"SELECT * FROM [{t}]")
            except Exception as e:  # noqa: BLE001
                print("ERR", e)
                continue
            names = [rs.Fields(i).Name for i in range(rs.Fields.Count)]
            n = 0
            while not rs.EOF and n < 40:
                row = {nm: rs.Fields(nm).Value for nm in names}
                print({k: v for k, v in row.items() if v is not None})
                rs.MoveNext()
                n += 1
            rs.Close()
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
    main(sys.argv[1:])
