SELECT DISTINCTROW NormElek.Datum, Avg([NormElek]![Uo]+3/([NormElek]![I Gesamt]/2.72)*(([NormElek]![U Gesamt]/[NormElek]![Elementzahl])-[NormElek]![Uo])-(([NormElek]![I Gesamt]/2.72)/3)*((90-([NormElek]![t An]+[NormElek]![t Ka])/2))*0.01+(([NormElek]![I Gesamt]/2.72)/3)*(32-[NormElek]![Cc])*0.02) AS [Un Mittel], Avg(NormElek.Cc) AS [Mittelwert von Cc]
FROM NormElek
GROUP BY NormElek.Datum
ORDER BY NormElek.Datum;
