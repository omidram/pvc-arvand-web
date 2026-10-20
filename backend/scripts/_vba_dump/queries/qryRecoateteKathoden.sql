SELECT tblKathodenrecoating.Kathodennummer, tblKathodenrecoating.Versanddatum, tblKathodenrecoating.Rücklieferdatum, tblKathodenrecoating.Hersteller, tblKathodenrecoating.Bemerkung
FROM tblKathodenrecoating
WHERE (((tblKathodenrecoating.Kathodennummer) Like (SELECT SucheKathodeninformation FROM tblGewDaten)));
