SELECT tblInspektionsgruende.ID, tblInspektionsgruende.IDSprache, tblInspektionsgruende.Code, tblInspektionsgruende.Inspektionsgrund
FROM tblInspektionsgruende
WHERE (((tblInspektionsgruende.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)))
ORDER BY tblInspektionsgruende.Inspektionsgrund;
