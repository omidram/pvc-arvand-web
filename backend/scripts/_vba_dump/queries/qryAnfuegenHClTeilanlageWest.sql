INSERT INTO tblAnalyseHClTeilanlage ( Datum, Zeit, [flow rate], HCl )
SELECT [Analyse HCl West].Datum, [Analyse HCl West].Zeit, [Analyse HCl West].[flow rate], [Analyse HCl West].HCl
FROM [Analyse HCl West];
