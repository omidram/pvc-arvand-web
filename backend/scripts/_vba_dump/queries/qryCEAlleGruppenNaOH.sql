SELECT tblEingabeCEGruppeNaOH.Datum, tblEingabeCEGruppeNaOH.Gruppe, tblEingabeCEGruppeNaOH.CE
FROM tblGewDaten, tblEingabeCEGruppeNaOH
WHERE (((tblEingabeCEGruppeNaOH.Datum)>=[tblGewDaten].[Anfangsdatum] And (tblEingabeCEGruppeNaOH.Datum)<=[tblGewDaten].[Enddatum]) AND ((tblEingabeCEGruppeNaOH.CE) Is Not Null))
ORDER BY tblEingabeCEGruppeNaOH.Datum, tblEingabeCEGruppeNaOH.Gruppe;
