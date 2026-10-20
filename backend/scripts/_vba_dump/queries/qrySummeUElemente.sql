SELECT DISTINCTROW qryUiFuerUn.Normierung, Sum(qryUiFuerUn.Ui) AS [Summe von Ui], Count(qryUiFuerUn.Ui) AS [Anzahl von Ui], Avg(qryUiFuerUn.Ui) AS [Mittelwert von Ui]
FROM qryUiFuerUn
GROUP BY qryUiFuerUn.Normierung;
