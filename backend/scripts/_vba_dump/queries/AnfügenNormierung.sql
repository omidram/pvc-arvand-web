INSERT INTO Normierung ( Elektrolyseur, Datum, Zeit, [I Gesamt], Cc, [t An], [t Ka], Uo, [U Gesamt], n )
SELECT NormElek.Elektrolyseur, NormElek.Datum, NormElek.Zeit, NormElek.[I Gesamt], NormElek.Cc, NormElek.[t An], NormElek.[t Ka], NormElek.Uo, NormElek.[U Gesamt], NormElek.Elementzahl
FROM NormElek
WHERE (((NormElek.Datum)>#7/20/2004#));
