SELECT tblAnodenrecoating.Anodennummer, tblAnodenrecoating.Versanddatum, tblAnodenrecoating.Rücklieferdatum, tblAnodenrecoating.Hersteller, tblAnodenrecoating.Bemerkung
FROM tblAnodenrecoating
WHERE (((tblAnodenrecoating.Anodennummer) Like (SELECT SucheAnodeninformation FROM tblGewDaten)));
