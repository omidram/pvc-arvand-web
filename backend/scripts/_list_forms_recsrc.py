import pathlib
import re

f = pathlib.Path(__file__).parent / "_vba_dump" / "forms"
pat = re.compile(
    r"(?i)(frm(Tabelle|Diagramm)(Un|CE|SPC)|DiaGruppe|ListGrGes|NormElekGes|Gesamt Normierung|DiaGesamtElek|NormElek|"
    r"frmEingabe|frmTabelleEingabe|Datenerfassung|subfrm.*(Un|CE)|Dia)"
)
out = []
for p in sorted(f.glob("*.txt")):
    n = p.stem
    if not pat.match(n):
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    rs = re.findall(r'RecordSource ="([^"]*)"', t)
    out.append(f"{n} :: {rs[:2]}")
(pathlib.Path(__file__).parent / "_vba_dump" / "_forms_recsrc.txt").write_text("\n".join(out), encoding="utf-8")
print(len(out))
