SELECT DISTINCTROW Montage.[Element Nr], Montage.Elektrolyseur, Montage.Position, Montage.Generation, Montage.[Anoden Nr], Montage.[Kathoden Nr], Montage.[Membran Nr], Montage.Membrantyp, Montage.Gruppe, Montage.[Einschalt Datum], Montage.[Ausschalt Datum], [Ausschalt Datum]-[Einschalt Datum] AS GesamtDOL, Date()-[Einschalt Datum] AS AktuelleDOL, Montage.Abschaltgrund, Montage.[Anode Coating], Montage.[Anode Electrode], Montage.[Anode Shell], Montage.[Cathode Coating], Montage.[Cathode Electrode], Montage.[Cathode Shell], Montage.[Info Membrane], Montage.Remarks, Montage.[Montage Datum], Montage.[Demontage Datum], Montage.[Elektroden Abstand]
FROM Montage
WHERE (((Montage.[Einschalt Datum]) Like "*") AND ((Montage.[Ausschalt Datum]) Is Null))
ORDER BY Montage.[Element Nr];
