SELECT tblListeInspektionsgruende.Inspektionsgrund, tblListeInspektionsgruende.[Element Nr]
FROM tblListeInspektionsgruende, tblGewDaten
WHERE (((tblListeInspektionsgruende.Inspektionsgrund) Like (SELECT SucheInspektionsgrund FROM tblGewDaten)));
