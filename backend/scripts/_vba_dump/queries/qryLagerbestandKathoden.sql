SELECT *
FROM tblKathodendetails
WHERE (((tblKathodendetails.Stillegungsdatum) Is Null) AND ((tblKathodendetails.Kathodennummer) Not In (SELECT [Kathoden Nr]
FROM qryMontierteElemente2)));
