import json
from pathlib import Path

d = json.loads(Path("scripts/access_hub_forms.json").read_text(encoding="utf-8"))
out = []
out.append(f"ALL FORMS {d.get('all_forms_count')}")
for n in d.get("all_forms", []):
    low = n.lower()
    if any(
        k in low
        for k in (
            "menu",
            "auswahl",
            "header",
            "element",
            "montage",
            "norm",
            "un",
            "ce",
            "analyse",
            "energie",
            "statistik",
            "abschalt",
            "bemerk",
            "leistung",
            "such",
            "einzel",
            "gruppe",
        )
    ):
        out.append(n)
out.append("\n---DUMPED CAPTIONS---")
for fn, layout in d.get("forms", {}).items():
    out.append(
        f"\n==== {fn} found={layout.get('found')} caption={layout.get('caption')} rs={layout.get('record_source')}"
    )
    if not layout.get("found"):
        out.append(f" ERR {layout.get('error')}")
        continue
    for c in layout.get("controls", []):
        cap = c.get("caption") or c.get("sourceobject") or ""
        if cap or c.get("type") in (104, 106, 105, 110, 109):
            out.append(
                f"  t={c.get('type')} L={c.get('left')} T={c.get('top')} {c.get('name')}: {cap!r}"
            )

Path("scripts/access_hub_summary.txt").write_text("\n".join(out), encoding="utf-8")
print("wrote scripts/access_hub_summary.txt", len(out))
