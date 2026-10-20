SELECT StromAusBerA.Elektrolyseur, StromAusBerA.Datum, UnElekA.i, ((([UnElekA]![Un]-2.42)/3)*5+2.42)*1000/(1.4923*[StromAusBerA]![µNaOH]*0.01)-([StromAusBerA]![µNaOH]-95)*6 AS Energieverbrauch, UnElekA.Un, StromAusBerA.[µNaOH] AS CE
FROM StromAusBerA INNER JOIN UnElekA ON (StromAusBerA.Datum = UnElekA.Datum) AND (StromAusBerA.Elektrolyseur = UnElekA.Elektrolyseur);
