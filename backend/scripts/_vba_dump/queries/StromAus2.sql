SELECT StromAus1.Elektrolyseur, StromAus1.Datum, StromAus1.Zeit, StromAus1.[flow rate], StromAus1.[NaClO3 Pb], StromAus1.[NaClO3 An], StromAus1.[Na2SO4 Pb], StromAus1.[Na2SO4 An], StromAus1.[NaOH Pb], StromAus1.[Na2CO3 Pb], StromAus1.[NaOCl Pb], StromAus1.[NaOCl An], StromAus1.[HCl Pb], StromAus1.[HCl An], [Analyse Chlorgas].[Cl2 + CO2 Cl], [Analyse Chlorgas].[O2 Cl]
FROM StromAus1 INNER JOIN [Analyse Chlorgas] ON (StromAus1.Elektrolyseur = [Analyse Chlorgas].Elektrolyseur) AND (StromAus1.Datum = [Analyse Chlorgas].Datum)
ORDER BY StromAus1.Elektrolyseur, StromAus1.Datum;
