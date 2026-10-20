SELECT DISTINCTROW Montage.Gruppe, [Gesamt Normierung].Datum, [Gesamt Normierung].Un, [Gesamt Normierung].iRef, [Gesamt Normierung].i
FROM ([Gesamt Normierung] INNER JOIN Um ON ([Gesamt Normierung].Datum = Um.Datum) AND ([Gesamt Normierung].Elektrolyseur = Um.Elektrolyseur)) INNER JOIN Montage ON ([Gesamt Normierung].Position = Montage.Position) AND ([Gesamt Normierung].Elektrolyseur = Montage.Elektrolyseur)
WHERE ((([Gesamt Normierung].Datum)>=[Montage]![Einschalt Datum]))
ORDER BY Montage.Gruppe, [Gesamt Normierung].Datum;
