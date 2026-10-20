SELECT DISTINCTROW Montage.[Element Nr], Montage.[Anoden Nr], Montage.[Kathoden Nr], Montage.Membrantyp, Montage.[Einschalt Datum], Montage.[Ausschalt Datum], *
FROM Montage
WHERE (((Montage.[Einschalt Datum]) Like "*") AND ((Montage.[Ausschalt Datum]) Is Null))
ORDER BY Montage.[Element Nr];
