"""Dump Anodische Bilanz (Current Efficiency hub) captions and OpenForm targets."""
from __future__ import annotations

import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_anod.mdb"
OUT_DIR = Path(__file__).resolve().parent


def main() -> None:
    if COPY.exists():
        COPY.unlink()
    shutil.copy2(SRC, COPY)
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        tmp = OUT_DIR / "_anod_raw.txt"
        for fn in ("Anodische Bilanz", "An StromAusGes"):
            acc.SaveAsText(2, fn, str(tmp))
            text = tmp.read_text(encoding="utf-8", errors="ignore")
            interesting = []
            for ln in text.splitlines():
                s = ln.strip()
                if any(k in s for k in ("Caption", "OpenForm", "RecordSource")):
                    interesting.append(s)
            out = OUT_DIR / f"_anod_{fn.replace(' ', '_')}.txt"
            out.write_text("\n".join(interesting), encoding="utf-8")
            print("====", fn)
            for ln in interesting:
                if "OpenForm" in ln or any(
                    k in ln
                    for k in (
                        "Data Input",
                        "CE from",
                        "NaOH",
                        "Total Plant",
                        "Train",
                        "Electrolyzer",
                        "Group",
                        "Element",
                        "Current Efficiency",
                        "EingabeCE",
                        "Menue",
                        "Menu",
                        "Basis",
                    )
                ):
                    print(ln)
            if tmp.exists():
                tmp.unlink()
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


if __name__ == "__main__":
    main()
