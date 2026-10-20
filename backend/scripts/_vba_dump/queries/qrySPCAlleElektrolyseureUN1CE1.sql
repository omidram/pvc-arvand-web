SELECT qryUnAlleElektrolyseure.Elektrolyseur, qryUnAlleElektrolyseure.Datum, qryUnAlleElektrolyseure.i, SPCBer([qryUnAlleElektrolyseure]![Un],[qryCEAlleElektrolyseure]![µNaOH]) AS Energieverbrauch, qryUnAlleElektrolyseure.Un, qryCEAlleElektrolyseure.µNaOH AS CE, GetGewIRef() AS iRefSPC
FROM qryUnAlleElektrolyseure INNER JOIN qryCEAlleElektrolyseure ON (qryUnAlleElektrolyseure.Datum = qryCEAlleElektrolyseure.Datum) AND (qryUnAlleElektrolyseure.Elektrolyseur = qryCEAlleElektrolyseure.Elektrolyseur)
ORDER BY qryUnAlleElektrolyseure.Elektrolyseur, qryUnAlleElektrolyseure.Datum;
