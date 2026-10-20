SELECT UnElekFV.Elektrolyseur, UnElekFV.Datum, UnElekFV.i, Avg([AB PLS EA A]![Energieverbrauch]-7*(90-[UnElekFV]![tm])-6*([StromAusBerA]![µNaOH]-[PLS]![Garantierter Stromverbrauch])-14*([UnElekFV]![Cc]-32)) AS EKA, UnElekFV.Un, StromAusBerA.[µNaOH], PLS.[Garantierter Stromverbrauch]
FROM PLS, (UnElekFV INNER JOIN [AB PLS EA A] ON (UnElekFV.Datum = [AB PLS EA A].Datum) AND (UnElekFV.Elektrolyseur = [AB PLS EA A].Elektrolyseur)) INNER JOIN StromAusBerA ON (UnElekFV.Datum = StromAusBerA.Datum) AND (UnElekFV.Elektrolyseur = StromAusBerA.Elektrolyseur)
GROUP BY UnElekFV.Elektrolyseur, UnElekFV.Datum, UnElekFV.i, UnElekFV.Un, StromAusBerA.[µNaOH], PLS.[Garantierter Stromverbrauch]
HAVING (((UnElekFV.Elektrolyseur)="A"));
