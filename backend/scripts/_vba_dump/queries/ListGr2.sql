SELECT ListGr.Gruppe, ListGr.Datum, Avg(ListGr.Un) AS [Mittelwert von Un], ListGr.iRef, Avg(ListGr.i) AS [Mittelwert von i]
FROM ListGr
GROUP BY ListGr.Gruppe, ListGr.Datum, ListGr.iRef;
