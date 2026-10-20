SELECT UnElekFV.Elektrolyseur, UnElekFV.Datum, UnElekFV.Zeit, UnElekFV.i, ([UnElekFV]![Mittelwert von Ui]*1000)/(1.4923*[StromAusBerA]![µNaOH]*0.01) AS Energieverbrauch, [StromAusBerA]![µNaOH] AS Ausdr1, UnElekFV.[Mittelwert von Ui]
FROM UnElekFV INNER JOIN StromAusBerA ON (UnElekFV.Datum = StromAusBerA.Datum) AND (UnElekFV.Elektrolyseur = StromAusBerA.Elektrolyseur)
WHERE (((UnElekFV.Elektrolyseur)="A"));
