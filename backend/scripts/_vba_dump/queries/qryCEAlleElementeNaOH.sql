SELECT tblEingabeCEElementNaOH.Elektrolyseur, tblEingabeCEElementNaOH.Position, "El. "+[tblEingabeCEElementNaOH]![Elektrolyseur]+" Pos. "+Format([tblEingabeCEElementNaOH]![Position],"0") AS Bezeichnung, tblEingabeCEElementNaOH.Datum, tblEingabeCEElementNaOH.Zeit, tblEingabeCEElementNaOH.CE
FROM tblGewDaten, tblEingabeCEElementNaOH
WHERE (((tblEingabeCEElementNaOH.Datum)>=[tblGewDaten].[Anfangsdatum] And (tblEingabeCEElementNaOH.Datum)<=[tblGewDaten].[Enddatum]) AND ((tblEingabeCEElementNaOH.CE)<>(-1)))
ORDER BY tblEingabeCEElementNaOH.Datum;
