SELECT Spannungen.Elektrolyseur, Spannungen.Position, Spannungen.Datum, Spannungen.Ui, NormF.[I Gesamt], NormF.Cc, NormF.[t An], NormF.[t Ka], NormF.Uo, *
FROM NormF INNER JOIN Spannungen ON NormF.Normierung = Spannungen.Normierung
ORDER BY Spannungen.Elektrolyseur, Spannungen.Position;
