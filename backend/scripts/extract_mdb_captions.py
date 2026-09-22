"""Pull printable English captions from the Access MDB binary (no COM)."""
from pathlib import Path
import re
import json

mdb = Path(r"c:\Users\Omid\Downloads\New folder (4)\PVC_Arvand_kofigurierte Datenbank.mdb")
out = Path(__file__).resolve().parent / "access_mdb_captions.json"
data = mdb.read_bytes()

needles = [
    b"Current Efficiency",
    b"Power Consumption",
    b"Display Results",
    b"Main Menu",
    b"Shut Down",
    b"Import Analyses",
    b"Anod. Bal",
    b"NaOH Prod",
    b"Total Plant",
    b"Electrolyzer",
    b"Time Period",
    b"Results as",
    b"Performance Test",
    b"Single Element Voltages",
    b"Shut Down List",
    b"Element Voltages",
    b"Distribution Un",
    b"Average Power",
    b"Data Input",
    b"Calculation for",
    b"Individual Train",
    b"All Trains",
    b"Various Electrolyseurs",
    b"Lean Caustic",
    b"Pure Brine",
    b"Anolyte",
    b"Catholyte",
    b"Demin. Water",
    b"HCl to Anolyte",
    b"HCl for Acidification",
    b"Update Display",
    b"U min",
    b"Class [V]",
    b"Part of Plant",
    b"SPC [kWh",
    b"CE [%]",
]

hits = {}
for n in needles:
    idx = data.find(n)
    hits[n.decode("latin-1")] = idx

# Extract nearby printable ASCII strings around each hit
context = {}
for label, idx in hits.items():
    if idx < 0:
        context[label] = None
        continue
    start = max(0, idx - 80)
    end = min(len(data), idx + 200)
    chunk = data[start:end]
    printable = re.sub(rb"[^\x20-\x7e]+", b" | ", chunk).decode("ascii", "ignore")
    context[label] = printable[:400]

# Also collect unique Form_ names already known, plus Caption-like English phrases
phrases = set()
for m in re.finditer(rb"(?:Caption|caption)[^\x20-\x7e]{0,8}([A-Z][A-Za-z0-9 ./%\[\]\-]{4,60})", data):
    phrases.add(m.group(1).decode("ascii", "ignore"))

english_labels = sorted(
    {s.decode("ascii") for s in re.findall(rb"\x00([A-Z][A-Za-z][A-Za-z0-9 ./%\[\]]{6,50})\x00", data)}
)

out.write_text(
    json.dumps(
        {
            "hits": hits,
            "context": context,
            "caption_like": sorted(phrases)[:400],
            "english_labels_sample": english_labels[:800],
            "english_count": len(english_labels),
        },
        indent=2,
        ensure_ascii=False,
    ),
    encoding="utf-8",
)
print(f"wrote {out} english={len(english_labels)}")
