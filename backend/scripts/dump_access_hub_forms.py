"""Dump Access hub-form layouts (captions, positions) and extract Uhde PDF text."""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT_FORMS = ROOT / "access_hub_forms.json"
OUT_PDF = ROOT / "uhde_manual_extract.txt"
MDB = Path(r"c:\Users\Omid\Downloads\New folder (4)\PVC_Arvand_kofigurierte Datenbank.mdb")
MDB_COPY = ROOT / "_tmp_pvc_arvand.mdb"

HUB_FORMS = [
    "Header",
    "Current",
    "Energieverbrauch",
    "Analyse",
    "UnCE",
    "frmMenuStatistik",
    "frmMenuAbschaltungen",
    "frmBemerkungen",
    "frmTabelleLeistungstests",
    "frmAnalysenEinlesen",
    "frmEnergieverbrauchDurchschnitt",
    "frmStatistikVerteilungUN",
    "frmStatistikAbweichungUn",
    "frmAbschaltungen",
    "frmAbschaltungsUrsachen",
    "frmAbschaltungskategorien",
    "frmAbschaltungenZeitraum",
    "frmAbschaltungszusammenfassung",
    "frmAbschaltungszusammenfassungKategorie",
    "Such",
    "frmAnordnung",
    "frmEinstellungen",
    "frmAboutEAP",
    "frmMontagedaten",
]


def extract_pdf() -> None:
    downloads = Path(r"C:\Users\Omid\Downloads")
    pdfs = sorted(downloads.glob("uhde administrator*.pdf"), key=lambda p: p.stat().st_size)
    lines = [f"found {len(pdfs)} pdfs"]
    for p in pdfs:
        lines.append(f"FILE size={p.stat().st_size} name={p.name}")
    # Prefer the ~1.9MB original, then converted 17MB
    chosen = None
    for p in pdfs:
        if p.stat().st_size > 1_000_000 and "converted" not in p.name.lower() and "(" not in p.name:
            chosen = p
            break
    if chosen is None and pdfs:
        chosen = max(pdfs, key=lambda p: p.stat().st_size)
    lines.append(f"CHOSEN={chosen.name if chosen else None}")

    text_chunks: list[str] = []
    if chosen:
        try:
            from pypdf import PdfReader

            reader = PdfReader(str(chosen))
            lines.append(f"pages={len(reader.pages)}")
            for i, page in enumerate(reader.pages, 1):
                t = page.extract_text() or ""
                text_chunks.append(f"\n\n===== PAGE {i} =====\n{t}")
        except Exception as exc:
            lines.append(f"pypdf failed: {exc}")
            try:
                import fitz

                doc = fitz.open(str(chosen))
                lines.append(f"pymupdf pages={doc.page_count}")
                for i, page in enumerate(doc, 1):
                    text_chunks.append(f"\n\n===== PAGE {i} =====\n{page.get_text()}")
            except Exception as exc2:
                lines.append(f"pymupdf failed: {exc2}")
    OUT_PDF.write_text("\n".join(lines) + "".join(text_chunks), encoding="utf-8")
    print(f"Wrote {OUT_PDF} ({OUT_PDF.stat().st_size} bytes)")


def dump_control(c) -> dict:
    item: dict = {"name": str(c.Name)}
    try:
        item["type"] = int(c.ControlType)
    except Exception:
        pass
    for attr in ("Caption", "ControlSource", "SourceObject", "RowSource"):
        try:
            val = getattr(c, attr, None)
            if val:
                item[attr.lower()] = str(val)[:500]
        except Exception:
            pass
    for attr in ("Left", "Top", "Width", "Height"):
        try:
            item[attr.lower()] = int(getattr(c, attr))
        except Exception:
            pass
    return item


def dump_forms() -> None:
    out: dict = {"mdb": str(MDB), "exists": MDB.is_file(), "forms": {}, "all_forms": []}
    if not MDB.is_file():
        OUT_FORMS.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
        print("MDB missing")
        return

    # Copy so we can open even if Access already has the original locked.
    try:
        shutil.copy2(MDB, MDB_COPY)
        target = MDB_COPY
        out["opened"] = str(target)
    except Exception as exc:
        target = MDB
        out["copy_error"] = str(exc)
        out["opened"] = str(target)

    import win32com.client

    acc = win32com.client.DispatchEx("Access.Application")
    try:
        acc.Visible = False
    except Exception:
        pass
    try:
        acc.OpenCurrentDatabase(str(target), False)
        all_forms = sorted(acc.CurrentProject.AllForms(i).Name for i in range(acc.CurrentProject.AllForms.Count))
        out["all_forms"] = all_forms
        out["all_forms_count"] = len(all_forms)

        wanted = list(HUB_FORMS)
        # Also pick likely CE/Un selection menus by name
        for name in all_forms:
            low = name.lower()
            if any(k in low for k in ("menu", "auswahl", "stromausbeute", "leistung", "header", "energie")):
                if name not in wanted:
                    wanted.append(name)

        for fn in wanted:
            if fn not in all_forms and fn not in {n for n in all_forms}:
                # try anyway
                pass
            layout: dict = {"found": False}
            try:
                acc.DoCmd.OpenForm(fn, 1)  # acDesign
                frm = acc.Forms(fn)
                controls = [dump_control(frm.Controls(i)) for i in range(frm.Controls.Count)]
                layout = {
                    "found": True,
                    "record_source": "",
                    "control_count": len(controls),
                    "controls": controls,
                }
                try:
                    layout["record_source"] = str(frm.RecordSource or "")
                except Exception:
                    pass
                try:
                    layout["caption"] = str(frm.Caption or "")
                except Exception:
                    pass
                acc.DoCmd.Close(2, fn)
            except Exception as exc:
                layout = {"found": False, "error": str(exc)}
            out["forms"][fn] = layout

        acc.CloseCurrentDatabase()
    except Exception as exc:
        out["open_error"] = str(exc)
    try:
        acc.Quit()
    except Exception:
        pass

    OUT_FORMS.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT_FORMS}")
    print(f"all_forms={out.get('all_forms_count')} dumped={len(out.get('forms', {}))}")


if __name__ == "__main__":
    extract_pdf()
    try:
        dump_forms()
    except Exception as exc:
        print(f"dump_forms failed: {exc}", file=sys.stderr)
        OUT_FORMS.write_text(json.dumps({"error": str(exc)}, ensure_ascii=False, indent=2), encoding="utf-8")
