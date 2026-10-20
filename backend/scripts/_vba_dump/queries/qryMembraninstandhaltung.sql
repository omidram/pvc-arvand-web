SELECT tblMembraninstandhaltung.Reparaturdatum, tblMembraninstandhaltung.Membrannummer, tblMembraninstandhaltung.Reparatur
FROM tblMembraninstandhaltung
WHERE (((tblMembraninstandhaltung.Membrannummer) Like (SELECT SucheMembraninformation FROM tblGewDaten)));
