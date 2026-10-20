SELECT DISTINCTROW Montage.Membrantyp, Montage.[Membran Nr]
FROM Montage
GROUP BY Montage.Membrantyp, Montage.[Membran Nr];
