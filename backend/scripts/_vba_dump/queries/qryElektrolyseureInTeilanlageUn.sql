SELECT tblTeilanlagenbezeichnung.Bezeichnung AS Teilanlagenbezeichnung, tblElektrolyseuranordnung.Bezeichnung AS Elektrolyseurbezeichnung
FROM tblGewDaten INNER JOIN (tblTeilanlagenbezeichnung INNER JOIN tblElektrolyseuranordnung ON tblTeilanlagenbezeichnung.Bezeichnung = tblElektrolyseuranordnung.Teilanlage) ON tblGewDaten.IDTeilanlageUNTeilanlage = tblTeilanlagenbezeichnung.Nr
GROUP BY tblTeilanlagenbezeichnung.Bezeichnung, tblElektrolyseuranordnung.Bezeichnung;
