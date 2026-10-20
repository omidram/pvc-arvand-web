SELECT tblEingabeCETeilanlageNaOH.Datum, tblEingabeCETeilanlageNaOH.Teilanlage, tblEingabeCETeilanlageNaOH.CE
FROM tblEingabeCETeilanlageNaOH, tblGewDaten
WHERE (((tblEingabeCETeilanlageNaOH.Teilanlage)=(SELECT Bezeichnung FROM tblTeilanlagenbezeichnung WHERE tblGewDaten.IDTeilanlageCETeilanlage = tblTeilanlagenbezeichnung.Nr)));
