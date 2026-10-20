SELECT DISTINCTROW Montage.Elektrolyseur, Montage.Position, Montage.[Anoden Nr], Montage.[Kathoden Nr], Montage.Membrantyp, Montage.[Montage Datum], Montage.[Element Nr], Montage.[Einschalt Datum], Montage.[Ausschalt Datum]
FROM Montage, tblGewDaten
WHERE (((Montage.Elektrolyseur)=(SELECT Bezeichnung FROM tblElektrolyseuranordnung WHERE tblGewDaten.IDAnordnung = tblElektrolyseuranordnung.ID)) AND ((Montage.Position) Between (SELECT Anfangsposition FROM tblElektrolyseuranordnung WHERE tblGewDaten.IDAnordnung = tblElektrolyseuranordnung.ID) And (SELECT Endposition FROM tblElektrolyseuranordnung WHERE tblGewDaten.IDAnordnung = tblElektrolyseuranordnung.ID)) AND ((Montage.[Ausschalt Datum]) Is Null))
ORDER BY Montage.Position;
