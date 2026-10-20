SELECT DISTINCTROW Montage.Membrantyp, Montage.[Membran Nr], Montage.[Einschalt Datum]
FROM Montage
WHERE (((Montage.[Einschalt Datum])=Null));
