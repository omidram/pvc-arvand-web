SELECT qryLagerbestandKathoden.Hersteller, qryLagerbestandKathoden.Generation, Count(qryLagerbestandKathoden.Kathodennummer) AS AnzahlKathoden
FROM qryLagerbestandKathoden
GROUP BY qryLagerbestandKathoden.Hersteller, qryLagerbestandKathoden.Generation;
