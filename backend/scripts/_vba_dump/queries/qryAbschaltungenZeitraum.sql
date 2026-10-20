SELECT tblAbschaltungen.Nr, tblAbschaltungen.Abschaltzeitpunkt, tblAbschaltungen.Einschaltzeitpunkt, ([Einschaltzeitpunkt]-[Abschaltzeitpunkt])*24 AS Dauer, tblAbschaltungen.Code, tblAbschaltungen.Ursache, tblAbschaltungen.Kategorie, tblAbschaltungen.Bemerkung
FROM tblGewDaten, tblAbschaltungsursachen INNER JOIN tblAbschaltungen ON tblAbschaltungsursachen.Abschaltungsursache = tblAbschaltungen.Ursache
WHERE (((tblAbschaltungen.Abschaltzeitpunkt)>=[tblGewDaten].[SucheAnfangsdatum] And (tblAbschaltungen.Abschaltzeitpunkt)<=[tblGewDaten].[SucheEnddatum]));
