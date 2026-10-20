SELECT qryLagerbestandMembranen.Membrantyp, Count(qryLagerbestandMembranen.Membrannummer) AS AnzahlMembranen
FROM qryLagerbestandMembranen
GROUP BY qryLagerbestandMembranen.Membrantyp;
