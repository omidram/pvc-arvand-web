"""Read-only audit of every relationship around Assembly Data (elements).

Usage:  python scripts/audit_assembly_relations.py [path/to/db.sqlite] [--samples N]
"""
from __future__ import annotations

import re
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

DB = Path(__file__).resolve().parents[1] / "instance" / "pvc_arvand.db"
SAMPLES = 5


def key(value) -> str:
    return re.sub(r"\s+", "", str(value or "")).upper()


def pos_key(value) -> str:
    text = str(value or "").strip()
    return str(int(text)) if re.fullmatch(r"\d+", text) else text


def day(value):
    text = str(value or "")[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def main() -> None:
    global SAMPLES
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--samples" in sys.argv:
        SAMPLES = int(sys.argv[sys.argv.index("--samples") + 1])
        args = [a for a in args if a != str(SAMPLES)]
    path = Path(args[0]) if args else DB
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row

    def rows(sql, *params):
        return con.execute(sql, params).fetchall()

    report: list[tuple[str, int, list[str]]] = []

    def add(title: str, items: list[str]):
        report.append((title, len(items), items[:SAMPLES]))

    els = rows("select * from elements")
    anodes = rows("select * from anodes")
    cathodes = rows("select * from cathodes")
    membranes = rows("select * from membranes")
    groups = {key(r["group_nr"]) for r in rows("select group_nr from group_definitions")}
    el_names = {key(r["name"]) for r in rows("select name from electrolyzers")}
    arrangements = rows("select * from electrolyzer_arrangements")

    anode_keys = {key(r["anode_nr"]) for r in anodes}
    cathode_keys = {key(r["cathode_nr"]) for r in cathodes}
    membrane_keys = {key(r["membrane_nr"]) for r in membranes}

    # 1. master catalogues: compact duplicates
    for title, items, col in (
        ("anodes duplicate after removing spaces/case", anodes, "anode_nr"),
        ("cathodes duplicate after removing spaces/case", cathodes, "cathode_nr"),
        ("membranes duplicate after removing spaces/case", membranes, "membrane_nr"),
    ):
        seen = defaultdict(list)
        for r in items:
            seen[key(r[col])].append(r[col])
        add(title, [f"{k}: {v}" for k, v in seen.items() if len(v) > 1])

    # 2. elements -> masters
    add("elements.anode_nr missing from anodes", sorted({f"{r['anode_nr']} (el {r['element_nr']})" for r in els if key(r["anode_nr"]) and key(r["anode_nr"]) not in anode_keys}))
    add("elements.cathode_nr missing from cathodes", sorted({f"{r['cathode_nr']} (el {r['element_nr']})" for r in els if key(r["cathode_nr"]) and key(r["cathode_nr"]) not in cathode_keys}))
    add("elements.membrane_nr missing from membranes", sorted({f"{r['membrane_nr']} (el {r['element_nr']})" for r in els if key(r["membrane_nr"]) and key(r["membrane_nr"]) not in membrane_keys}))
    add("elements without anode_nr", [f"id {r['id']} el {r['element_nr']}" for r in els if not key(r["anode_nr"])])
    add("elements without cathode_nr", [f"id {r['id']} el {r['element_nr']}" for r in els if not key(r["cathode_nr"])])
    add("elements without membrane_nr", [f"id {r['id']} el {r['element_nr']}" for r in els if not key(r["membrane_nr"])])
    add("elements without electrolyzer/position", [f"id {r['id']} el {r['element_nr']}" for r in els if not key(r["electrolyzer"]) or not key(r["position"])])
    add("elements.electrolyzer not in electrolyzers", sorted({str(r["electrolyzer"]) for r in els if key(r["electrolyzer"]) and key(r["electrolyzer"]) not in el_names}))
    add("elements.group_nr not in group_definitions", sorted({str(r["group_nr"]) for r in els if key(r["group_nr"]) and key(r["group_nr"]) not in groups}))

    # 3. stored text vs normalized text (child tables join by exact text in several places)
    def spacey(col, items):
        return [str(r[col]) for r in items if r[col] is not None and str(r[col]) != str(r[col]).strip()]

    add("elements with leading/trailing spaces in anode/cathode/membrane/electrolyzer/position",
        [f"id {r['id']}" for r in els if any(r[c] is not None and str(r[c]) != str(r[c]).strip() for c in ("anode_nr", "cathode_nr", "membrane_nr", "electrolyzer", "position", "element_nr"))])
    add("masters with edge spaces in key", spacey("anode_nr", anodes) + spacey("cathode_nr", cathodes) + spacey("membrane_nr", membranes))

    # 4. child tables -> masters
    for table, col, keys in (
        ("anode_maintenance", "anode_nr", anode_keys),
        ("anode_recoating", "anode_nr", anode_keys),
        ("anode_coating_checks", "anode_nr", anode_keys),
        ("cathode_maintenance", "cathode_nr", cathode_keys),
        ("cathode_recoating", "cathode_nr", cathode_keys),
        ("cathode_coating_checks", "cathode_nr", cathode_keys),
        ("membrane_maintenance", "membrane_nr", membrane_keys),
    ):
        data = rows(f"select id, {col} from {table}")
        add(f"{table}.{col} missing from master", [f"id {r['id']}: {r[col]}" for r in data if key(r[col]) not in keys])
        add(f"{table}.{col} differs from master by spaces/case", [f"id {r['id']}: {r[col]}" for r in data if key(r[col]) in keys and r[col] not in {a[0] for a in rows(f'select {col} from {"anodes" if "anode" in table else "cathodes" if "cathode" in table else "membranes"}')}])

    seg = rows("select id, serial_nr, electrode_kind from electrode_segregations")
    add("segregation serial in neither anodes nor cathodes", [f"id {r['id']}: {r['serial_nr']}" for r in seg if key(r["serial_nr"]) not in anode_keys and key(r["serial_nr"]) not in cathode_keys])
    add("segregation kind anode but serial only in cathodes (or reverse)", [f"id {r['id']}: {r['serial_nr']} {r['electrode_kind']}" for r in seg if (r["electrode_kind"] == "anode" and key(r["serial_nr"]) not in anode_keys and key(r["serial_nr"]) in cathode_keys) or (r["electrode_kind"] == "cathode" and key(r["serial_nr"]) not in cathode_keys and key(r["serial_nr"]) in anode_keys)])
    seg_unknown = [r for r in seg if not r["electrode_kind"] or r["electrode_kind"] == "unknown"]
    add("segregation rows with unknown kind", [f"id {r['id']}: {r['serial_nr']}" for r in seg_unknown])

    # 5. inspections / grids -> elements
    el_nrs = {key(r["element_nr"]) for r in els}
    for table in ("inspection_reports", "assembly_inspection_reports", "inspection_halfshell_grids"):
        try:
            data = rows(f"select id, element_nr from {table}")
        except sqlite3.Error:
            continue
        add(f"{table}.element_nr not in elements", [f"id {r['id']}: {r['element_nr']}" for r in data if key(r["element_nr"]) and key(r["element_nr"]) not in el_nrs])
    for r in rows("select id, element_nr, anode_nr, cathode_nr, membrane_nr from inspection_reports"):
        pass
    insp = rows("select id, element_nr, anode_nr, cathode_nr, membrane_nr from inspection_reports")
    el_by_nr = defaultdict(list)
    for r in els:
        el_by_nr[key(r["element_nr"])].append(r)
    mism = []
    for i in insp:
        cands = el_by_nr.get(key(i["element_nr"])) or []
        if cands and not any(key(c["anode_nr"]) == key(i["anode_nr"]) and key(c["cathode_nr"]) == key(i["cathode_nr"]) for c in cands):
            mism.append(f"insp {i['id']} el {i['element_nr']}: {i['anode_nr']}/{i['cathode_nr']}")
    add("inspection anode/cathode do not match any installation of that element_nr", mism)

    # 6. element numbers reused for different hardware
    by_nr = defaultdict(set)
    for r in els:
        k = key(r["element_nr"])
        if k:
            by_nr[k].add((key(r["anode_nr"]), key(r["cathode_nr"])))
    reused = {k: v for k, v in by_nr.items() if len(v) > 1}
    add("element_nr reused for different anode/cathode pairs (history by element_nr mixes hardware)", [f"{k}: {len(v)} pairs" for k, v in reused.items()])
    add("element rows with no element_nr", [f"id {r['id']}" for r in els if not key(r["element_nr"])])

    # 7. overlapping / duplicated installations
    def span(r):
        start = day(r["assembly_date"]) or day(r["commissioning_date"])
        end = day(r["disassembly_date"]) or day(r["decommissioning_date"])
        return start, end

    active_cell = defaultdict(list)
    for r in els:
        if day(r["disassembly_date"]) is None and key(r["electrolyzer"]) and key(r["position"]):
            active_cell[(key(r["electrolyzer"]), pos_key(r["position"]))].append(r)
    add("cell (electrolyzer+position) has more than one not-disassembled installation",
        [f"{k}: ids {[x['id'] for x in v]}" for k, v in active_cell.items() if len(v) > 1])

    for label, col in (("anode", "anode_nr"), ("cathode", "cathode_nr"), ("membrane", "membrane_nr")):
        active = defaultdict(list)
        for r in els:
            if day(r["disassembly_date"]) is None and key(r[col]):
                active[key(r[col])].append(r)
        add(f"{label} installed in more than one not-disassembled element",
            [f"{k}: ids {[x['id'] for x in v]}" for k, v in active.items() if len(v) > 1])
        # overlapping periods of the same part
        by_part = defaultdict(list)
        for r in els:
            if key(r[col]):
                by_part[key(r[col])].append(r)
        overlaps = []
        for k, lst in by_part.items():
            spans = sorted(((span(x), x["id"]) for x in lst if span(x)[0]), key=lambda t: t[0][0])
            for (a, ia), (b, ib) in zip(spans, spans[1:]):
                if a[1] is None or a[1] > b[0]:
                    overlaps.append(f"{k}: ids {ia}/{ib}")
        add(f"{label} periods overlap (re-installed before it was removed)", overlaps)

    dup_install = Counter((key(r["electrolyzer"]), pos_key(r["position"]), str(r["assembly_date"])[:10], key(r["anode_nr"]), key(r["cathode_nr"])) for r in els)
    add("exact duplicate installations", [f"{k}: x{n}" for k, n in dup_install.items() if n > 1 and k[0]])

    # 8. date logic
    bad = []
    for r in els:
        a, c, d, x = day(r["assembly_date"]), day(r["commissioning_date"]), day(r["disassembly_date"]), day(r["decommissioning_date"])
        if a and c and c < a:
            bad.append(f"id {r['id']} commissioning before assembly")
        if c and x and x < c:
            bad.append(f"id {r['id']} decommissioning before commissioning")
        if a and d and d < a:
            bad.append(f"id {r['id']} disassembly before assembly")
        if x and d and d < x:
            bad.append(f"id {r['id']} disassembly before decommissioning")
        if a and a > date.today():
            bad.append(f"id {r['id']} assembly in future")
    add("date order problems", bad)
    add("decommissioned but no disassembly date and no reason", [f"id {r['id']}" for r in els if day(r["decommissioning_date"]) and not day(r["disassembly_date"]) and not (r["decommission_reason"] or "").strip()])
    add("decommission_reason set but no decommissioning/disassembly date", [f"id {r['id']}" for r in els if (r["decommission_reason"] or "").strip() and not day(r["decommissioning_date"]) and not day(r["disassembly_date"])])

    # 9. element copy vs master (denormalized values)
    mem_type = {key(r["membrane_nr"]): (r["membrane_type"] or "").strip() for r in membranes}
    add("element.membrane_type differs from membranes.membrane_type",
        [f"id {r['id']} {r['membrane_nr']}: '{r['membrane_type']}' vs '{mem_type.get(key(r['membrane_nr']))}'" for r in els if key(r["membrane_nr"]) in mem_type and (r["membrane_type"] or "").strip() and mem_type[key(r["membrane_nr"])] and (r["membrane_type"] or "").strip().upper() != mem_type[key(r["membrane_nr"])].upper()])
    add("element has membrane_type but master membrane has none",
        [f"{r['membrane_nr']}" for r in els if key(r["membrane_nr"]) in mem_type and (r["membrane_type"] or "").strip() and not mem_type[key(r["membrane_nr"])]])

    anode_coat = {key(r["anode_nr"]): (r["coating"] or "").strip() for r in anodes}
    cathode_coat = {key(r["cathode_nr"]): (r["coating"] or "").strip() for r in cathodes}
    add("element.anode_coating differs from anodes.coating", [f"id {r['id']} {r['anode_nr']}: '{r['anode_coating']}' vs '{anode_coat.get(key(r['anode_nr']))}'" for r in els if key(r["anode_nr"]) in anode_coat and (r["anode_coating"] or "").strip() and anode_coat[key(r["anode_nr"])] and (r["anode_coating"] or "").strip().upper() != anode_coat[key(r["anode_nr"])].upper()])
    add("element.cathode_coating differs from cathodes.coating", [f"id {r['id']} {r['cathode_nr']}: '{r['cathode_coating']}' vs '{cathode_coat.get(key(r['cathode_nr']))}'" for r in els if key(r["cathode_nr"]) in cathode_coat and (r["cathode_coating"] or "").strip() and cathode_coat[key(r["cathode_nr"])] and (r["cathode_coating"] or "").strip().upper() != cathode_coat[key(r["cathode_nr"])].upper()])
    add("element.generation differs from anode/cathode generation", [f"id {r['id']}" for r in els if r["generation"] and key(r["anode_nr"]) in anode_keys and any((a["generation"] or "") and key(a["anode_nr"]) == key(r["anode_nr"]) and (a["generation"] or "").strip().upper() != r["generation"].strip().upper() for a in anodes)])

    # 10. master decommission date vs installations
    last_dis = {}
    for r in els:
        d = day(r["disassembly_date"]) or day(r["decommissioning_date"])
        for col in ("anode_nr", "cathode_nr", "membrane_nr"):
            k = key(r[col])
            if k and d and (k not in last_dis or d > last_dis[k]):
                last_dis[k] = d
    active_keys = {key(r[c]) for r in els if day(r["disassembly_date"]) is None for c in ("anode_nr", "cathode_nr", "membrane_nr") if key(r[c])}
    add("master decommission_date set while part still installed in a not-disassembled element",
        [f"{r['anode_nr']}" for r in anodes if r["decommission_date"] and key(r["anode_nr"]) in active_keys]
        + [f"{r['cathode_nr']}" for r in cathodes if r["decommission_date"] and key(r["cathode_nr"]) in active_keys]
        + [f"{r['membrane_nr']}" for r in membranes if r["decommission_date"] and key(r["membrane_nr"]) in active_keys])

    # 11. position vs arrangement block
    blocks = defaultdict(list)
    for a in arrangements:
        try:
            blocks[key(a["name"])].append((int(a["start_position"]), int(a["end_position"])))
        except (TypeError, ValueError):
            pass
    out_of_range = []
    for r in els:
        if key(r["electrolyzer"]) in blocks and re.fullmatch(r"\d+", str(r["position"] or "").strip()):
            p = int(str(r["position"]).strip())
            if not any(lo <= p <= hi for lo, hi in blocks[key(r["electrolyzer"])]):
                out_of_range.append(f"id {r['id']} {r['electrolyzer']} pos {r['position']}")
    add("element position outside electrolyzer arrangement ranges", out_of_range)
    add("element position not numeric", [f"id {r['id']}: {r['position']!r}" for r in els if str(r["position"] or "").strip() and not re.fullmatch(r"\d+", str(r["position"]).strip())])
    add("element position stored without 3-digit padding", [f"id {r['id']}: {r['position']!r}" for r in els if re.fullmatch(r"\d{1,2}", str(r["position"] or "").strip())])

    # 12. voltage readings point at a real installation
    try:
        v_cells = {(key(r[0]), pos_key(r[1])) for r in rows("select distinct electrolyzer, position from voltage_readings")}
        e_cells = {(key(r["electrolyzer"]), pos_key(r["position"])) for r in els}
        add("voltage reading cells with no installation in Assembly Data", [f"{a} pos {b}" for a, b in sorted(v_cells - e_cells)])
    except sqlite3.Error:
        pass

    print(f"DB: {path}")
    print(f"elements={len(els)} anodes={len(anodes)} cathodes={len(cathodes)} membranes={len(membranes)}\n")
    width = max(len(t) for t, *_ in report)
    for title, n, samples in report:
        flag = "OK " if n == 0 else "!! "
        print(f"{flag}{title.ljust(width)}  {n}")
        for s in samples:
            print(f"      - {s}")


if __name__ == "__main__":
    main()
