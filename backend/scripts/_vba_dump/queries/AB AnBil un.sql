SELECT [AB PLS EA Mittel].Datum, [AB PLS EA Mittel].[EA Mittel], [AB PLS U Mittel].[Un Mittel], [AB PLS CEA Mittel].[Mittelwert von µNaOH]
FROM ([AB PLS EA Mittel] INNER JOIN [AB PLS U Mittel] ON [AB PLS EA Mittel].Datum = [AB PLS U Mittel].Datum) INNER JOIN [AB PLS CEA Mittel] ON [AB PLS U Mittel].Datum = [AB PLS CEA Mittel].Datum;
