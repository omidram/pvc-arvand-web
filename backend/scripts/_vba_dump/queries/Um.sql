SELECT DISTINCTROW [Gesamt Normierung].Elektrolyseur, [Gesamt Normierung].Datum, [Gesamt Normierung].Zeit, Avg([Gesamt Normierung].Ui) AS [Mittelwert von Ui], [Gesamt Normierung].[I Gesamt], ([I Gesamt]/2.72) AS i, [Gesamt Normierung].Cc, [Gesamt Normierung].[t An], [Gesamt Normierung].[t Ka], ([t An]+[t Ka])/2 AS tm, [Gesamt Normierung].Uo
FROM [Gesamt Normierung]
GROUP BY [Gesamt Normierung].Elektrolyseur, [Gesamt Normierung].Datum, [Gesamt Normierung].Zeit, [Gesamt Normierung].[I Gesamt], ([I Gesamt]/2.72), [Gesamt Normierung].Cc, [Gesamt Normierung].[t An], [Gesamt Normierung].[t Ka], ([t An]+[t Ka])/2, [Gesamt Normierung].Uo
HAVING (((Avg([Gesamt Normierung].Ui))>(Select Umin from tblGewDaten)))
ORDER BY [Gesamt Normierung].Datum;
