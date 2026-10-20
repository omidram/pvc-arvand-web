SELECT Montage.[Element Nr], Montage.[Ausschalt Datum], Montage.[Demontage Datum]
FROM Montage
GROUP BY Montage.[Element Nr], Montage.[Ausschalt Datum], Montage.[Demontage Datum]
HAVING (((Montage.[Ausschalt Datum]) Is Not Null)) OR (((Montage.[Demontage Datum]) Is Not Null))
ORDER BY Montage.[Element Nr];
