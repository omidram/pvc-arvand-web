SELECT tblAnodencoatingpruefung.Anodennummer, tblAnodencoatingpruefung.Anodencoatingnummer, tblAnodencoatingpruefung.DOL, tblAnodencoatingpruefung.Prüfdatum, tblAnodencoatingpruefung.Prüfer, tblAnodencoatingpruefung.Restschichtdicke, tblAnodencoatingpruefung.Potential, tblAnodencoatingpruefung.Bemerkung
FROM tblAnodencoatingpruefung
WHERE (((tblAnodencoatingpruefung.Anodennummer) Like (SELECT SucheAnodeninformation FROM tblGewDaten)));
