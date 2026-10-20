SELECT UnGruppenMitteldat.Datum AS Ausdr1, UnGruppenMitteldat.Gruppe AS Ausdr2, UnGruppenMitteldat.[Un Mittel] AS Ausdr3, [UnGruppenMitteldat].[Membrantyp] AS Ausdr4, UnGruppenMitteldat.[Anzahl von Element Nr] AS Ausdr5, UnGruppenMitteldat.[Elektroden Abstand] AS Ausdr6
FROM UnGruppenMitteldat
WHERE ((([UnGruppenMitteldat].[Datum])=[Datum?]));
