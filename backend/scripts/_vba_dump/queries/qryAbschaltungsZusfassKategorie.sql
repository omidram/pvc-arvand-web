SELECT Sum(([Einschaltzeitpunkt]-[Abschaltzeitpunkt])*24) AS Dauer, Count(tblAbschaltungen.Ursache) AS [Anzahl von Ursache], tblAbschaltungen.Kategorie, tblAbschaltungen.Ursache, tblAbschaltungen.Code
FROM tblAbschaltungsursachen INNER JOIN tblAbschaltungen ON tblAbschaltungsursachen.Abschaltungsursache = tblAbschaltungen.Ursache
GROUP BY tblAbschaltungen.Kategorie, tblAbschaltungen.Ursache, tblAbschaltungen.Code;
