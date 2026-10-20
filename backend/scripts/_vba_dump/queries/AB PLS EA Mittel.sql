SELECT [AB PLS CEA Mittel].Datum, ([AB PLS U Mittel]![Un Mittel]*1000)/(1.4923*[AB PLS CEA Mittel]![Mittelwert von µNaOH]*0.01) AS [EA Mittel]
FROM [AB PLS CEA Mittel] INNER JOIN [AB PLS U Mittel] ON [AB PLS CEA Mittel].Datum = [AB PLS U Mittel].Datum;
