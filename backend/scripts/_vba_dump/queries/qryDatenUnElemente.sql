SELECT DISTINCTROW Normierung.Elektrolyseur, Normierung.Datum
FROM (tblGewDaten INNER JOIN tblElektrolyseurbezeichnung ON tblGewDaten.IDElektrolyseurVerteilungUN = tblElektrolyseurbezeichnung.Nr) INNER JOIN Normierung ON tblElektrolyseurbezeichnung.Bezeichnung = Normierung.Elektrolyseur
GROUP BY Normierung.Elektrolyseur, Normierung.Datum;
