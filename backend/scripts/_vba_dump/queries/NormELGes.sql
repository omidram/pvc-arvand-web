SELECT DISTINCTROW NormElek.Elektrolyseur, NormElek.Datum, NormElek.Zeit, [NormElek]![Uo]+3/([NormElek]![I Gesamt]/2.72)*(([NormElek]![U Gesamt]/[NormElek]![Elementzahl])-[NormElek]![Uo])-(([NormElek]![I Gesamt]/2.72)/3)*((90-([NormElek]![t An]+[NormElek]![t Ka])/2))*0.01+(([NormElek]![I Gesamt]/2.72)/3)*(32-[NormElek]![Cc])*0.02 AS Un INTO ElekDia
FROM NormElek
WHERE ((NormElek.Datum>=[Auswertungsbeginn]![Datum] And NormElek.Datum<=[Auswertungsende]![Datum]))
ORDER BY NormElek.Elektrolyseur, NormElek.Datum, NormElek.Zeit;
