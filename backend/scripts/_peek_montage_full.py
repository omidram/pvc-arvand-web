"""Dry-run the full montage workbook against the assembly field map."""
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.plant_import import parse_assembly_excel

path = Path(r"C:\Users\Omid\Downloads\Files (1)\مونتاژ - نصب و دی مونتاژ.xlsx")
content = path.read_bytes()
limited = parse_assembly_excel(content)
full = parse_assembly_excel(content, from_year=None)
print("from 1395", limited.get("recognized"), limited.get("imported"), limited.get("error"))
print("all rows", full.get("recognized"), full.get("imported"), full.get("error"))
rows = full.get("elements") or []
print("sample0", rows[0] if rows else None)
print("sample1390-looking", rows[1] if len(rows) > 1 else None)
years = Counter()
missing_asm = 0
for row in rows:
    day = row.get("assembly_date") or ""
    years[day[:4] or "none"] += 1
    if not row.get("assembly_date"):
        missing_asm += 1
print("missing assembly date", missing_asm)
print("gregorian years", sorted(years.items())[:8], "...", sorted(years.items())[-5:])
filled = Counter()
for row in rows:
    for key, value in row.items():
        if value not in (None, "", False):
            filled[key] += 1
print("filled", dict(filled))
