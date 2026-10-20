SELECT *
FROM tblAnodendetails
WHERE (((tblAnodendetails.Stillegungsdatum) Is Null) AND ((tblAnodendetails.Anodennummer) Not In (SELECT [Anoden Nr]
FROM qryMontierteElemente2)));
