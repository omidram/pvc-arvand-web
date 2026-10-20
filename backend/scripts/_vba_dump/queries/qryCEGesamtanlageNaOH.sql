SELECT tblEingabeCEGesamtanlageNaOH.Datum, tblEingabeCEGesamtanlageNaOH.CE
FROM tblGewDaten, tblEingabeCEGesamtanlageNaOH
WHERE (((tblEingabeCEGesamtanlageNaOH.Datum)>=[tblGewDaten].[Anfangsdatum] And (tblEingabeCEGesamtanlageNaOH.Datum)<=[tblGewDaten].[Enddatum]));
