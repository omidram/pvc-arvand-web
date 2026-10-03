"""Translate German shutdown causes / categories to English (plant UI language)."""
import sqlite3
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"

CAUSE_MAP = {
    "Prozessleitsystemfehler": "Process control system fault",
    "Elektrischer Fehler": "Electrical fault",
    "Instrumentierungsfehler": "Instrumentation fault",
    "Mechanischer Fehler": "Mechanical fault",
    "Unzulässige Betriebszustände": "Unallowed operating conditions",
    "Unzulassige Betriebszustande": "Unallowed operating conditions",
    "Geplanter Stillstand": "Planned shut down",
    "Ursache unbekannt": "Unknown reason",
    "Chlorverarbeitung": "Chlorine processing",
    "Leckage": "Leakage",
    "SPS Fehler": "PLC fault",
    "Bedienungsfehler": "Operator error",
}

CATEGORY_MAP = {
    "Donau Chemie": "Internal",
    "Sonstige": "Other",
}


def main() -> None:
    con = sqlite3.connect(DB)
    cur = con.cursor()
    updated = 0
    for old, new in CAUSE_MAP.items():
        cur.execute(
            "UPDATE shutdown_causes SET cause = ? WHERE cause = ?",
            (new, old),
        )
        updated += cur.rowcount
        # Mojibake / latin1-broken variants
        cur.execute(
            "UPDATE shutdown_causes SET cause = ? WHERE cause LIKE ?",
            (new, old[:8] + "%"),
        )
    for old, new in CATEGORY_MAP.items():
        cur.execute(
            "UPDATE shutdown_causes SET category = ? WHERE category = ?",
            (new, old),
        )
        updated += cur.rowcount
        cur.execute(
            "UPDATE shutdown_categories SET category = ? WHERE category = ?",
            (new, old),
        )
        updated += cur.rowcount
    # Force plant type label to NaCl electrolysis
    cur.execute("UPDATE plant_settings SET plant_type = 'NaCl' WHERE plant_type = 'KOH' OR plant_type IS NULL")
    con.commit()
    print("updated rows~", updated)
    for r in cur.execute("SELECT id, code, cause, category FROM shutdown_causes ORDER BY id").fetchall():
        print(repr(r))
    print("settings", cur.execute("SELECT id, plant_type, customer FROM plant_settings").fetchall())
    con.close()


if __name__ == "__main__":
    main()
