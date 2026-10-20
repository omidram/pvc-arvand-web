SELECT StromAus2.Elektrolyseur, StromAus2.Datum, StromAus2.Zeit, StromAus2.[flow rate], StromAus2.[Na2SO4 Pb], StromAus2.[Na2SO4 An], VAnolytBer([flow rate],[Na2SO4 Pb],[Na2SO4 An]) AS VAnolyt
FROM StromAus2
ORDER BY StromAus2.Elektrolyseur, StromAus2.Datum;
