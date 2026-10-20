from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
LOGO = ROOT / "frontend" / "public" / "logo-arvand.png"
OUTS = [ROOT / "frontend" / "public" / "favicon.png", ROOT / "frontend" / "src" / "app" / "icon.png"]


def bbox(region, threshold=248):
    px = region.load()
    w, h = region.size
    min_x, min_y, max_x, max_y = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 10:
                continue
            if r < threshold or g < threshold or b < threshold:
                found = True
                min_x, min_y = min(min_x, x), min(min_y, y)
                max_x, max_y = max(max_x, x), max(max_y, y)
    if not found:
        raise RuntimeError("empty region")
    return min_x, min_y, max_x, max_y


img = Image.open(LOGO).convert("RGBA")
w, h = img.size
left = img.crop((0, 0, int(w * 0.46), h))
x0, y0, x1, y1 = bbox(left)
band = y1 - y0 + 1
emblem = left.crop((x0, y0, x1, y0 + int(band * 0.58)))
ex0, ey0, ex1, ey1 = bbox(emblem, 240)
x0, y0 = x0 + ex0, y0 + ey0
x1, y1 = x0 + (ex1 - ex0), y0 + (ey1 - ey0)
cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
half = int(max(x1 - x0, y1 - y0) * 0.55)
left2 = max(0, cx - half)
top2 = max(0, cy - half)
right2 = min(w, cx + half)
bottom2 = min(h, cy + half)
side = min(right2 - left2, bottom2 - top2)
cx2, cy2 = (left2 + right2) // 2, (top2 + bottom2) // 2
half2 = side // 2
square = img.crop((cx2 - half2, cy2 - half2, cx2 + half2, cy2 + half2))
fav = square.resize((64, 64), Image.Resampling.LANCZOS)
log = ROOT / "_test_write.txt"
log.write_text(
    f"img={w}x{h} emblem=({x0},{y0})-({x1},{y1}) crop=({cx2-half2},{cy2-half2})-({cx2+half2},{cy2+half2}) square={square.size}\n",
    encoding="utf-8",
)
for p in OUTS:
    p.parent.mkdir(parents=True, exist_ok=True)
    fav.save(p, "PNG")
    log.write_text(log.read_text(encoding="utf-8") + f"wrote {p}\n", encoding="utf-8")

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.database import SessionLocal
from app.energy import plant_timeseries
from app.models import Element, ElectrolyzerNormalization, VoltageReading

db = SessionLocal()
try:
    lines = [
        f"elements {db.query(Element).count()}",
        f"norms {db.query(ElectrolyzerNormalization).count()}",
        f"readings {db.query(VoltageReading).count()}",
    ]
    d = plant_timeseries(db, scope="plant")
    lines.append(f"trends {d['total']} {len(d['points'])}")
finally:
    db.close()
log.write_text(log.read_text(encoding="utf-8") + "\n".join(lines) + "\n", encoding="utf-8")
