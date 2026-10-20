SELECT tblEingabeCEElektrolyseurNaOH.Datum, tblEingabeCEElektrolyseurNaOH.Elektrolyseur, tblEingabeCEElektrolyseurNaOH.CE
FROM tblEingabeCEElektrolyseurNaOH, tblGewDaten
WHERE (((tblEingabeCEElektrolyseurNaOH.Datum)>=[tblGewDaten].[Anfangsdatum] And (tblEingabeCEElektrolyseurNaOH.Datum)<=[tblGewDaten].[Enddatum]) AND ((tblEingabeCEElektrolyseurNaOH.Elektrolyseur)=(SELECT Bezeichnung FROM tblElektrolyseurbezeichnung WHERE tblGewDaten.IDElektrolyseurUnCeSpcElektrolyseur = tblElektrolyseurbezeichnung.Nr)) AND ((tblEingabeCEElektrolyseurNaOH.CE) Is Not Null))
ORDER BY tblEingabeCEElektrolyseurNaOH.Datum, tblEingabeCEElektrolyseurNaOH.Elektrolyseur;
