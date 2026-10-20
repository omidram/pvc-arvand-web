"""Dump Access Current Efficiency hub form (Current) and related VBA OpenForm targets."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

import win32com.client

SRC = Path(
    r"C:\Users\Omid\Downloads\ELEMENT administration program\ELEMENT administration program"
    r"\PVC_Arvand_kofigurierte Datenbank_2016-09-04_2016-09-05_(1).mdb"
)
COPY = Path(__file__).resolve().parent / "_tmp_ce_hub.mdb"
OUT = Path(__file__).resolve().parent / "_ce_hub.json"


def dump_control(c) -> dict:
    item = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr in ("Caption", "ControlSource", "RowSource", "OnClick", "OnDblClick"):
        try:
            val = getattr(c, attr, None)
            if val not in (None, ""):
                item[attr.lower()] = str(val)[:1000]
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
    out: dict = {"forms": {}, "modules_snippets": []}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        names = [acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count)]
        out["all_forms_with_ce"] = [n for n in names if "ce" in n.lower() or "strom" in n.lower() or n == "Current"]
        for fn in ("Current", "UnCE", "Header"):
            if fn not in names:
                out["forms"][fn] = {"found": False}
                continue
            acc.DoCmd.OpenForm(fn, 1)
            frm = acc.Forms(fn)
            controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
            out["forms"][fn] = {
                "found": True,
                "caption": str(getattr(frm, "Caption", "") or ""),
                "control_count": len(controls),
                "controls": controls,
            }
            acc.DoCmd.Close(2, fn)

        # Scan form module VBA text via SaveAsText if available
        for fn in out["all_forms_with_ce"][:40]:
            tmp = Path(__file__).resolve().parent / f"_frm_{fn}.txt"
            try:
                acc.SaveAsText(2, fn, str(tmp))  # acForm=2
                text = tmp.read_text(encoding="utf-8", errors="ignore")
                if "EingabeCE" in text or "OpenForm" in text and "CE" in text:
                    # keep relevant lines
                    lines = [ln for ln in text.splitlines() if any(k in ln for k in ("EingabeCE", "OpenForm", "Caption", "DoCmd"))]
                    out["modules_snippets"].append({"form": fn, "lines": lines[:80]})
            except Exception as exc:
                out["modules_snippets"].append({"form": fn, "error": str(exc)})
            finally:
                if tmp.exists():
                    try:
                        tmp.unlink()
                    except Exception:
                        pass
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
    print(f"Wrote {OUT}")


if __name__ == "__main__":
    main()
