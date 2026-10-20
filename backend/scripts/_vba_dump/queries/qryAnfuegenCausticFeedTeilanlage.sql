INSERT INTO [Analyse caustic feed Teilanlage] ( Datum, Zeit, [flow rate], NaOH, Fe, temperature )
SELECT [Analyse caustic feed Ost].Datum, [Analyse caustic feed Ost].Zeit, [Analyse caustic feed Ost].[flow rate], [Analyse caustic feed Ost].NaOH, [Analyse caustic feed Ost].Fe, [Analyse caustic feed Ost].temperature
FROM [Analyse caustic feed Ost];
