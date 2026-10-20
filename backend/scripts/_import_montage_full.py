"""Import the whole montage workbook into Assembly Data (no 1395 cutoff)."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal
from app.models import Element
from app.plant_import import parse_assembly_excel
from app.routers.elements import _apply_assembly_import

path = Path(r"C:\Users\Omid\Downloads\Files (1)\مونتاژ - نصب و دی مونتاژ.xlsx")
parsed = parse_assembly_excel(path.read_bytes(), from_year=None)
print("parsed", parsed.get("imported"), "recognized", parsed.get("recognized"), flush=True)

def progress(done, total):
    if done == total or done % 1000 == 0:
        print(f"progress {done}/{total}", flush=True)

db = SessionLocal()
before = db.query(Element).count()
print("elements before", before, flush=True)
try:
    result = _apply_assembly_import(db, parsed, "upsert", progress)
finally:
    after = db.query(Element).count()
    db.close()
print("elements after", after, flush=True)
keep = {k: result[k] for k in ("created", "updated", "skipped", "imported_rows", "dol_updated", "catalogs_created")}
print(keep, flush=True)
