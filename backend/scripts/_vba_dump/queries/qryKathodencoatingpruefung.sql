SELECT tblKathodencoatingpruefung.Kathodennummer, tblKathodencoatingpruefung.Restschichtdicke, tblKathodencoatingpruefung.Potential, tblKathodencoatingpruefung.Prüfer, tblKathodencoatingpruefung.Prüfdatum, tblKathodencoatingpruefung.Bemerkung
FROM tblKathodencoatingpruefung
WHERE (((tblKathodencoatingpruefung.Kathodennummer) Like (SELECT SucheKathodeninformation FROM tblGewDaten)));
