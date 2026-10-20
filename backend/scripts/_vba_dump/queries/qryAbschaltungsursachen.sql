SELECT tblAbschaltungsursachen.ID, tblAbschaltungsursachen.IDSprache, tblAbschaltungsursachen.Code, tblAbschaltungsursachen.Abschaltungsursache, tblAbschaltungsursachen.Kategorie
FROM tblAbschaltungsursachen
WHERE (((tblAbschaltungsursachen.IDSprache)=(SELECT IDSprache FROM  tblGewDaten)));
