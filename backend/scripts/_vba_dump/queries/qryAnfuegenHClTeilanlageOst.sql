INSERT INTO tblAnalyseHClTeilanlage ( Datum, Zeit, [flow rate], HCl )
SELECT [Analyse HCl Ost].Datum, [Analyse HCl Ost].Zeit, [Analyse HCl Ost].[flow rate], [Analyse HCl Ost].HCl
FROM [Analyse HCl Ost];
