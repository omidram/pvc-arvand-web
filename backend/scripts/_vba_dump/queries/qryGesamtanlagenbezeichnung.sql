SELECT tblGesamtanlagenbezeichnung.Bezeichnung
FROM tblGesamtanlagenbezeichnung INNER JOIN tblGewDaten ON tblGesamtanlagenbezeichnung.IDSprache = tblGewDaten.IDSprache;
