SELECT qryCEElektrolyseur.Elektrolyseur, qryCEElektrolyseur.Datum, qryUnElektrolyseur2.i, SPCBer([qryUnElektrolyseur2]![Un],[qryCEElektrolyseur]![µNaOH]) AS Energieverbrauch, qryUnElektrolyseur2.Un, qryCEElektrolyseur.µNaOH AS CE, GetGewIRef() AS iRefSPC
FROM qryCEElektrolyseur INNER JOIN qryUnElektrolyseur2 ON (qryCEElektrolyseur.Datum = qryUnElektrolyseur2.Datum) AND (qryCEElektrolyseur.Elektrolyseur = qryUnElektrolyseur2.Elektrolyseur)
ORDER BY qryCEElektrolyseur.Elektrolyseur, qryCEElektrolyseur.Datum;
