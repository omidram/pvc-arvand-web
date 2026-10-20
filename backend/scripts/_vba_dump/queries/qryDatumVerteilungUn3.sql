SELECT [Normierung].[Datum]-[tblGewDaten].[DatumVerteilungUn] AS Tage, Normierung.Elektrolyseur, Normierung.Datum, tblGewDaten.DatumVerteilungUN
FROM Normierung, tblGewDaten
WHERE (((Normierung.Datum)<=[tblGewDaten].[DatumVerteilungUn]));
