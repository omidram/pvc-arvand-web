SELECT DISTINCTROW Spannungen.Normierung, Spannungen.Ui
FROM Spannungen
WHERE (((Spannungen.Ui)>(Select Umin from tblGewDaten)));
