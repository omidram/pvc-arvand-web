SELECT tblAbschaltungsursachen.Code, tblAbschaltungen.Ursache, Count(tblAbschaltungen.Ursache) AS Anzahl
FROM tblAbschaltungsursachen INNER JOIN tblAbschaltungen ON tblAbschaltungsursachen.Abschaltungsursache = tblAbschaltungen.Ursache
GROUP BY tblAbschaltungsursachen.Code, tblAbschaltungen.Ursache;
