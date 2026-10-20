"""Check how the assembly parser reads the latest montage workbook."""
from collections import Counter
from pathlib import Path

from app.plant_import import parse_assembly_excel

path = sorted(Path(r"C:\Users\Omid\Downloads").glob("*(2).xlsx"), key=lambda p: p.stat().st_mtime, reverse=True)[0]
parsed = parse_assembly_excel(path.read_bytes())
print("recognized", parsed.get("recognized"), "imported", parsed.get("imported"), "error", parsed.get("error"))
rows = parsed.get("elements") or []
print("sample", rows[:2])
svc = Counter()
dol_ready = 0
for row in rows:
    remarks = row.get("remarks") or ""
    if "OUT OF SERVICE" in remarks:
        svc["out_in_remarks"] += 1
    if "IN SERVICE" in remarks:
        svc["in_in_remarks"] += 1
    if row.get("disassembly_date"):
        svc["has_dismantle"] += 1
    if row.get("commissioning_date"):
        svc["has_install"] += 1
    if row.get("assembly_date"):
        svc["has_assembly"] += 1
    if row.get("anode_nr"):
        svc["anode"] += 1
    if row.get("cathode_nr"):
        svc["cathode"] += 1
print(dict(svc))
