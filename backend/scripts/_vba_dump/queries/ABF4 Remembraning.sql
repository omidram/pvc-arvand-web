SELECT DISTINCTROW DOL.[Element Nr], DOL.[Anoden Nr], DOL.[Kathoden Nr], DOL.Membrantyp, DOL.[Montage Datum], Sum(DOL.DOL) AS [Summe von DOL]
FROM DOL
GROUP BY DOL.[Element Nr], DOL.[Anoden Nr], DOL.[Kathoden Nr], DOL.Membrantyp, DOL.[Montage Datum]
HAVING (((Sum(DOL.DOL))>1080));
