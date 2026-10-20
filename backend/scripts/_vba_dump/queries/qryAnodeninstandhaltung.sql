SELECT tblAnodeninstandhaltung.[Anoden Nr], tblAnodeninstandhaltung.Datum, tblAnodeninstandhaltung.Befund, tblAnodeninstandhaltung.Aktion, tblAnodeninstandhaltung.Versanddatum, tblAnodeninstandhaltung.Rücklieferung
FROM tblAnodeninstandhaltung
WHERE (((tblAnodeninstandhaltung.[Anoden Nr]) Like (SELECT SucheAnodeninformation FROM tblGewDaten)));
