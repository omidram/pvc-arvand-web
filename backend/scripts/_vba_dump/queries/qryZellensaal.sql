SELECT DISTINCTROW Montage.Elektrolyseur, Montage.Position, Montage.[Anoden Nr], Montage.[Kathoden Nr], Montage.Membrantyp, Montage.[Montage Datum], Montage.[Element Nr], Montage.[Einschalt Datum], Montage.[Ausschalt Datum]
FROM Montage, tblGewDaten
WHERE (((Montage.Elektrolyseur)=(SELECT BezeichnungAnordnung FROM tblGewDaten)) AND ((Montage.Position) Between (SELECT AnfangspositionAnordnung FROM tblGewDaten) And (SELECT EndpositionAnordnung FROM tblGewDaten)) AND ((Montage.[Ausschalt Datum]) Is Null))
ORDER BY Montage.Position;
