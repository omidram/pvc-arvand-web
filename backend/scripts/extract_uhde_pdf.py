"""Extract text from all Uhde administrator PDFs using PyMuPDF."""
from pathlib import Path

downloads = Path(r"C:\Users\Omid\Downloads")
out_dir = Path(__file__).resolve().parent
import pymupdf

pdfs = sorted(downloads.glob("uhde administrator*.pdf"), key=lambda p: p.stat().st_size)
index_lines = []
for p in pdfs:
    safe = f"pdf_{p.stat().st_size}.txt"
    dest = out_dir / safe
    doc = pymupdf.open(str(p))
    chunks = [f"FILE={p.name}\nSIZE={p.stat().st_size}\nPAGES={doc.page_count}\n"]
    for i, page in enumerate(doc, 1):
        chunks.append(f"\n===== PAGE {i} =====\n{page.get_text()}")
    dest.write_text("".join(chunks), encoding="utf-8")
    index_lines.append(f"{safe}\tpages={doc.page_count}\tsize={p.stat().st_size}\ttext_bytes={dest.stat().st_size}")
    print(index_lines[-1])

(out_dir / "pdf_index.txt").write_text("\n".join(index_lines), encoding="utf-8")
