from collections import Counter
from pathlib import Path

from app.plant_import import parse_assembly_excel

path = sorted(Path(r"C:\Users\Omid\Downloads").glob("*(2).xlsx"), key=lambda p: p.stat().st_mtime, reverse=True)[0]
rows = parse_assembly_excel(path.read_bytes())["elements"]
remarks = Counter((r.get("remarks") or "").strip() for r in rows if r.get("disassembly_date"))
print("dismantled", sum(remarks.values()))
print("with remark", sum(v for k, v in remarks.items() if k))
for text, n in remarks.most_common(40):
    print(f"{n:5} {text[:80]!r}")
