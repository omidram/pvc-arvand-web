SELECT tblInspektionsgruende.IDSprache, Count(tblInspektionsgruende.Code) AS Anzahl
FROM tblInspektionsgruende
GROUP BY tblInspektionsgruende.IDSprache
HAVING (((tblInspektionsgruende.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)));
