"""One-off: open recoating rows written by the old Live board button become workflow requests."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import models  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.element_dashboard import clear_cache  # noqa: E402
from app.warehouse import apply_move  # noqa: E402

BOARD_REMARK = "ارسال برای بازپوشش"

db = SessionLocal()
admin = db.query(models.User).filter_by(username="admin").one()
for model, field, kind in ((models.AnodeRecoating, "anode_nr", "anode"), (models.CathodeRecoating, "cathode_nr", "cathode")):
    rows = db.query(model).filter(model.dispatch_date.isnot(None), model.return_date.is_(None), model.remarks == BOARD_REMARK).all()
    for row in rows:
        serial, day = getattr(row, field), row.dispatch_date.date()
        db.delete(row)
        db.flush()
        try:
            print(serial, apply_move(db, kind, serial, "dispatch_recoating", day, None, admin))
        except ValueError as exc:
            db.rollback()
            print("FAILED", serial, exc)
clear_cache()
