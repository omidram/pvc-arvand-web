SELECT tblKathodeninstandhaltung.[Kathoden Nr], tblKathodeninstandhaltung.Datum, tblKathodeninstandhaltung.Befund, tblKathodeninstandhaltung.Aktion, tblKathodeninstandhaltung.Versanddatum, tblKathodeninstandhaltung.Rücklieferung
FROM tblKathodeninstandhaltung
WHERE (((tblKathodeninstandhaltung.[Kathoden Nr]) Like (SELECT SucheKathodeninformation FROM tblGewDaten)));
