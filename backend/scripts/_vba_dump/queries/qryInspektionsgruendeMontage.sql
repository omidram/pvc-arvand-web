SELECT tblInspektionsgruende.ID, tblInspektionsgruende.IDSprache, tblInspektionsgruende.Code, tblInspektionsgruende.Inspektionsgrund, tblInspektionsgruende.Gewaehlt
FROM tblInspektionsgruende
WHERE (((tblInspektionsgruende.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)))
ORDER BY tblInspektionsgruende.Code;
