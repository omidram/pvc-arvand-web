SELECT tblInspektionsberichtBefunde.ID, tblInspektionsberichtBefunde.IDSprache, tblInspektionsberichtBefunde.Code, tblInspektionsberichtBefunde.Inspektionsgrund, tblInspektionsberichtBefunde.Gewaehlt, tblInspektionsberichtBefunde.Anzahl
FROM tblInspektionsberichtBefunde
WHERE (((tblInspektionsberichtBefunde.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)));
