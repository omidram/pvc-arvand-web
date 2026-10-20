INSERT INTO Normierung ( Elektrolyseur, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], [U Gesamt] )
SELECT NormElek.Elektrolyseur, NormElek.Datum, EL0Ges.Zeit, EL0Ges.[I Ges], NormElek.Cc, [El0Ges].[tKA]-0.5 AS [t An], EL0Ges.tKA, NormElek.[U Gesamt]
FROM NormElek INNER JOIN EL0Ges ON (NormElek.Datum = EL0Ges.Datum) AND (NormElek.Elektrolyseur = EL0Ges.Elektrolyseur)
GROUP BY NormElek.Elektrolyseur, NormElek.Datum, EL0Ges.Zeit, EL0Ges.[I Ges], NormElek.Cc, [El0Ges].[tKA]-0.5, EL0Ges.tKA, NormElek.[U Gesamt];
