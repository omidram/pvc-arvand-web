"""Print caption + ControlSource of text boxes/labels for selected Access forms."""
import pathlib
import re
import sys

root = pathlib.Path(__file__).parent / "_vba_dump" / "forms"
names = sys.argv[1:] or [
    "frmTabelleCEElektrolyseur",
    "frmTabelleCEGesamtanlage",
    "frmTabelleCETeilanlage",
    "frmTabelleCEGruppe",
    "frmTabelleCEElement",
    "frmTabelleCEAlleTeilanlagen",
    "frmTabelleUnElektrolyseur",
    "frmTabelleUnElektrolyseur2",
    "frmTabelleUnGesamtanlage",
    "frmTabelleUnGesamtanlage2",
    "frmTabelleUnTeilanlage",
    "frmTabelleUnElement",
    "frmTabelleUnElement2",
    "frmTabelleUnGruppe",
    "frmTabelleUnGruppe2",
    "frmTabelleUnElektrolyseure",
    "frmTabelleUnMehrereGruppen",
    "frmTabelleCEElektrolyseurNaOH",
]
out = []
for n in names:
    p = root / f"{n}.txt"
    if not p.exists():
        out.append(f"## {n}: MISSING")
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    t = t[: t.find("CodeBehindForm")] if "CodeBehindForm" in t else t
    out.append(f"## {n}")
    # split into control blocks
    for m in re.finditer(r"Begin (TextBox|Label|ComboBox|CommandButton)\b(.*?)\n\s*End\n", t, re.S):
        kind, body = m.group(1), m.group(2)
        name = re.search(r'Name ="([^"]*)"', body)
        cs = re.search(r'ControlSource ="([^"]*)"', body)
        cap = re.search(r'Caption ="([^"]*)"', body)
        left = re.search(r"Left =(\d+)", body)
        fmt = re.search(r'Format ="([^"]*)"', body)
        if cs or cap:
            out.append(
                f"  {kind:10} L={left.group(1) if left else '':>6} {name.group(1) if name else '':28} "
                f"cs={cs.group(1) if cs else '':40} cap={cap.group(1) if cap else ''} fmt={fmt.group(1) if fmt else ''}"
            )
(pathlib.Path(__file__).parent / "_vba_dump" / "_cols.txt").write_text("\n".join(out), encoding="utf-8")
print(len(out))
