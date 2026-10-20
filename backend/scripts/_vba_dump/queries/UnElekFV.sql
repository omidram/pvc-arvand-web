SELECT DISTINCTROW NormElek.Elektrolyseur, NormElek.Datum, NormElek.Zeit, NormElek.[I Gesamt], [NormElek]![I Gesamt]/2.72 AS i, NormElek.Cc, NormElek.[t An], NormElek.[t Ka], ([NormElek]![t An]+[NormElek]![t Ka])/2 AS tm, NormElek.Uo, NormElek.[U Gesamt], NormElek.Elementzahl, [NormElek]![U Gesamt]/[NormElek]![Elementzahl] AS [Mittelwert von Ui], UnBer([Mittelwert von Ui],[i],[tm],[Cc]) AS Un
FROM NormElek
ORDER BY NormElek.Elektrolyseur, NormElek.Datum, NormElek.Zeit;
