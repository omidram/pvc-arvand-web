SELECT tblEingabeCEGruppeNaOH.Datum, tblEingabeCEGruppeNaOH.Gruppe, tblEingabeCEGruppeNaOH.CE
FROM tblGewDaten, tblGewGruppenUnCeSpc INNER JOIN tblEingabeCEGruppeNaOH ON tblGewGruppenUnCeSpc.Bezeichnung = tblEingabeCEGruppeNaOH.Gruppe
WHERE (((tblEingabeCEGruppeNaOH.Datum)>=[tblGewDaten].[Anfangsdatum] And (tblEingabeCEGruppeNaOH.Datum)<=[tblGewDaten].[Enddatum]) AND ((tblEingabeCEGruppeNaOH.CE) Is Not Null))
ORDER BY tblEingabeCEGruppeNaOH.Datum, tblEingabeCEGruppeNaOH.Gruppe;
