SELECT Spannungen.Elektrolyseur, Spannungen.Position, Spannungen.Normierung, Spannungen.Zeit, Spannungen.Ui, Montage.[Einschalt Datum], Montage.[Ausschalt Datum], Montage.Membrantyp, *
FROM Montage INNER JOIN Spannungen ON (Montage.Position = Spannungen.Position) AND (Montage.Elektrolyseur = Spannungen.Elektrolyseur)
WHERE (((Montage.Membrantyp)="F6801"));
