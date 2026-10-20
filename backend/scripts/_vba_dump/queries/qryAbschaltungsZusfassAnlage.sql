SELECT tblAbschaltungsursachen.Abschaltungsursache, tblAbschaltungsursachen.Code, tblAbschaltungen.Ursache, Sum(([Einschaltzeitpunkt]-[Abschaltzeitpunkt])*24) AS Dauer, Count(tblAbschaltungen.Ursache) AS [Anzahl von Ursache], tblAbschaltungen.Kategorie
FROM tblAbschaltungsursachen INNER JOIN tblAbschaltungen ON tblAbschaltungsursachen.Abschaltungsursache = tblAbschaltungen.Ursache
GROUP BY tblAbschaltungsursachen.Abschaltungsursache, tblAbschaltungsursachen.Code, tblAbschaltungen.Ursache, tblAbschaltungen.Kategorie;
