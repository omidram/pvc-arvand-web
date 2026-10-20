SELECT tblAnodenrecoating.Anodennummer, tblAnodenrecoating.Anodencoatingnummer, tblAnodenrecoating.Versanddatum, tblAnodenrecoating.Rücklieferdatum, tblAnodenrecoating.Hersteller, tblAnodenrecoating.[x-tes Recoating], tblAnodenrecoating.Bemerkung
FROM tblAnodenrecoating
WHERE (((tblAnodenrecoating.Anodennummer) Like (SELECT SucheAnodeninformation FROM tblGewDaten)));
