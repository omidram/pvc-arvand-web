"""Export the Access Analyse menu and find catholyte forms."""
from __future__ import annotations

import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_analysis.mdb"
OUT = Path(__file__).resolve().parent / "_analyse_menu.txt"

def main() -> None:
    if not COPY.exists():
        shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        names = [acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)]
        hits = [n for n in names if any(k in n.lower() for k in ("kath", "cath", "naoh", "lauge", "anolyt"))]
        print("HITS")
        for n in hits:
            print(" ", n)
        # acForm = 2
        acc.SaveAsText(2, "Analyse", str(OUT))
        print("exported", OUT, OUT.stat().st_size)
        acc.CloseCurrentDatabase()
    finally:
        acc.Quit()


if __name__ == "__main__":
    main()
