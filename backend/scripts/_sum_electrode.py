import json
from pathlib import Path

d = json.loads(Path("scripts/_electrode_forms.json").read_text(encoding="utf-8"))
for name, frm in d.items():
    print("====", name, "found", frm.get("found"), "cap", frm.get("caption"))
    src = (frm.get("recordsource") or "").replace("\n", " ")
    print("  RS", src[:200])
    for c in frm.get("controls") or []:
        cap = c.get("caption") or ""
        src = c.get("controlsource") or c.get("sourceobject") or ""
        if cap or src or c.get("type") in (104, 112):
            print(
                f"  t={c.get('type')} {c.get('name')} L={c.get('left')} T={c.get('top')} "
                f"cap={cap[:70]!r} src={src[:90]!r}"
            )
