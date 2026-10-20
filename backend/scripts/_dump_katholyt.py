"""Dump catholyte analysis form fields."""
from __future__ import annotations

import json
from pathlib import Path

import win32com.client

COPY = Path(__file__).resolve().parent / "_tmp_analysis.mdb"
OUT = Path(__file__).resolve().parent / "_katholyt_forms.json"
FORMS = [
    "An Katholyt",
    "An Katholyt Gesamt",
    "An Katholyt Gruppe",
    "An Katholyt Element",
    "An Katholyt Teilanlage",
]


def dump_control(c) -> dict:
    item = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr, key in (("Caption", "caption"), ("ControlSource", "controlsource")):
        try:
            val = getattr(c, attr, None)
            if val:
                item[key] = str(val)[:200]
        except Exception:
            pass
    for attr in ("Left", "Top"):
        try:
            item[attr.lower()] = int(getattr(c, attr))
        except Exception:
            pass
    return item


def main() -> None:
    acc = win32com.client.DispatchEx("Access.Application")
    acc.Visible = False
    out = {}
    try:
        acc.OpenCurrentDatabase(str(COPY), False)
        for fn in FORMS:
            acc.DoCmd.OpenForm(fn, 1)
            frm = acc.Forms(fn)
            controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
            out[fn] = {"caption": str(frm.Caption or ""), "record_source": str(frm.RecordSource or "")[:200], "controls": controls}
            acc.DoCmd.Close(2, fn)
        acc.CloseCurrentDatabase()
    finally:
        acc.Quit()
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    for name, frm in out.items():
        print("\n==", name, frm["record_source"])
        for c in sorted(frm["controls"], key=lambda x: (x.get("top", 0), x.get("left", 0))):
            cap = (c.get("caption") or "").replace("\n", " ").strip()
            src = c.get("controlsource") or ""
            if str(src).startswith("="):
                continue
            if not cap and not src:
                continue
            print(f"  top={c.get('top',0):5} left={c.get('left',0):5} {cap!r:28} {src}")


if __name__ == "__main__":
    main()
