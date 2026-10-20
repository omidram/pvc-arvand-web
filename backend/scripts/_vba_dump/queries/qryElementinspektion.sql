SELECT Montage.[Element Nr], Montage.[Anoden Nr], Montage.[Kathoden Nr], Montage.Membrantyp, Montage.[Membran Nr], Montage.[Elektroden Abstand], Montage.[Montage Datum], Montage.Remarks, Montage.Elektrolyseur, Montage.Position, Montage.[Einschalt Datum], Montage.[Ausschalt Datum], Montage.DOL, Montage.[Demontage Datum], Montage.Gruppe, Montage.Abschaltgrund, Montage.[Anode Coating], Montage.[Anode Electrode], Montage.[Anode Shell], Montage.[Cathode Coating], Montage.[Cathode Electrode], Montage.[Cathode Shell], Montage.[Info Membrane]
FROM Montage INNER JOIN tblGewDaten ON Montage.[Element Nr] = tblGewDaten.SucheElementnummer
WHERE (((Montage.[Ausschalt Datum]) Is Not Null)) OR (((Montage.[Demontage Datum]) Is Not Null))
ORDER BY Montage.[Element Nr];
