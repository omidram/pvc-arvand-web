SELECT ListGr.Gruppe, ListGr.Datum, Avg(ListGr.Un) AS [Mittelwert von Un], ListGr.iRef, Avg(ListGr.i) AS AvgOfi
FROM tblGewGruppenUnCeSpc INNER JOIN ListGr ON tblGewGruppenUnCeSpc.Bezeichnung = ListGr.Gruppe
GROUP BY ListGr.Gruppe, ListGr.Datum, ListGr.iRef;
