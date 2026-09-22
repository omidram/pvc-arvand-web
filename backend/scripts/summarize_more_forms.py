import json
from pathlib import Path

d = json.loads(Path("scripts/access_more_forms.json").read_text(encoding="utf-8"))
lines = ["ce_like count " + str(len(d.get("ce_like", [])))]
for fn, layout in d.get("forms", {}).items():
    lines.append(f"\n==== {fn} found={layout.get('found')} caption={layout.get('caption')}")
    if not layout.get("found"):
        lines.append(" ERR " + str(layout.get("error")))
        continue
    for c in layout.get("controls", []):
        cap = c.get("caption") or c.get("sourceobject") or ""
        if cap:
            lines.append(f"  t={c.get('type')} L={c.get('left')} T={c.get('top')} {c.get('name')}: {cap!r}")
Path("scripts/access_more_summary.txt").write_text("\n".join(lines), encoding="utf-8")
print("ok", len(lines))
