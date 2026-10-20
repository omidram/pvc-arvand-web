INSERT INTO [Analyse Catholyt Teilanlage] ( Datum, Zeit, [make-up water], temperature, NaOH, NaCl, NaClO3, Na2SO4, Fe )
SELECT [Analyse catholyt Ost].Datum, [Analyse catholyt Ost].Zeit, [Analyse catholyt Ost].[make-up water], [Analyse catholyt Ost].temperature, [Analyse catholyt Ost].NaOH, [Analyse catholyt Ost].NaCl, [Analyse catholyt Ost].NaClO3, [Analyse catholyt Ost].Na2SO4, [Analyse catholyt Ost].Fe
FROM [Analyse catholyt Ost];
