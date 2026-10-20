SELECT Normierung.Normierung, Normierung.Elektrolyseur, F6801.Position, Normierung.Datum, F6801.Membrantyp, *
FROM Normierung INNER JOIN F6801 ON Normierung.Elektrolyseur = F6801.Elektrolyseur
WHERE (((Normierung.Datum)>[F6801.Einschalt Datum]));
