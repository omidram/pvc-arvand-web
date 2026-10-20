SELECT tblMembrandetails.Eingangsdatum, tblMembrandetails.Membrantyp, tblMembrandetails.Membrannummer, tblMembrandetails.Bemerkung, tblMembrandetails.Stillegungsdatum, tblMembrandetails.Batch
FROM tblMembrandetails, tblGewDaten
WHERE (((tblMembrandetails.Membrannummer) Like (SELECT SucheMembraninformation FROM tblGewDaten)));
