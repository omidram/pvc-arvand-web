INSERT INTO [Analyse Anolyt Teilanlage] ( Datum, Zeit, [NaCl An], [NaClO3 An], [NaOCl An], [HCl An], [density at 20° An], [Na2SO4 An], [temperature An], [pH An] )
SELECT [Analyse anolyt Ost].Datum, [Analyse anolyt Ost].Zeit, [Analyse anolyt Ost].NaCl, [Analyse anolyt Ost].NaClO3, [Analyse anolyt Ost].HOCl, [Analyse anolyt Ost].HCl, [Analyse anolyt Ost].[density at 20°], [Analyse anolyt Ost].Na2SO4, [Analyse anolyt Ost].temperature, [Analyse anolyt Ost].pH
FROM [Analyse anolyt Ost];
