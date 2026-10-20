SELECT UnElekFV.Datum, Avg(UnElekFV.tm) AS [Mittelwert von tm]
FROM UnElekFV
GROUP BY UnElekFV.Datum;
