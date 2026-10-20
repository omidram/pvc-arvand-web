SELECT StromAusGes.Datum, Avg(StromAusGes.[µNaOH]) AS [Mittelwert von µNaOH]
FROM StromAusGes
GROUP BY StromAusGes.Datum;
