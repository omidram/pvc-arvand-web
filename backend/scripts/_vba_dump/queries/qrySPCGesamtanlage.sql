SELECT qryCEGesamtanlage.Datum, Avg(SPCBer([qryUnGesamtanlage]![Mittelwert von Un],[qryCEGesamtanlage]![Mittelwert von µNaOH])) AS Energieverbrauch, Avg(qryUnGesamtanlage.[Mittelwert von i]) AS iGes, Avg(qryUnGesamtanlage.[Mittelwert von Un]) AS UnGes, Avg(qryCEGesamtanlage.[Mittelwert von µNaOH]) AS CEGes, Avg(GetGewIRef()) AS iRefSPC
FROM qryUnGesamtanlage INNER JOIN qryCEGesamtanlage ON qryUnGesamtanlage.Datum = qryCEGesamtanlage.Datum
GROUP BY qryCEGesamtanlage.Datum;
