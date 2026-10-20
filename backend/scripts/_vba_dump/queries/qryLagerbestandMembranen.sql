SELECT *
FROM tblMembrandetails
WHERE (((tblMembrandetails.Stillegungsdatum) Is Null) AND ((tblMembrandetails.Membrannummer) Not In (SELECT [Membran Nr]
FROM qryMontierteElemente2)));
