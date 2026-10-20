SELECT qryLagerbestandAnoden.Hersteller, qryLagerbestandAnoden.Generation, Count(qryLagerbestandAnoden.Anodennummer) AS AnzahlAnoden
FROM qryLagerbestandAnoden
GROUP BY qryLagerbestandAnoden.Hersteller, qryLagerbestandAnoden.Generation;
