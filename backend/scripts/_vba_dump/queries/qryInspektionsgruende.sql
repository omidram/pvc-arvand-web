SELECT tblInspektionsgruende.ID, tblInspektionsgruende.IDSprache, tblInspektionsgruende.Code, tblInspektionsgruende.Inspektionsgrund, qryInspektionsgruendeAnzahl.Anzahl
FROM tblInspektionsgruende, qryInspektionsgruendeAnzahl
GROUP BY tblInspektionsgruende.ID, tblInspektionsgruende.IDSprache, tblInspektionsgruende.Code, tblInspektionsgruende.Inspektionsgrund, qryInspektionsgruendeAnzahl.Anzahl
HAVING (((tblInspektionsgruende.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)))
ORDER BY tblInspektionsgruende.Inspektionsgrund;
