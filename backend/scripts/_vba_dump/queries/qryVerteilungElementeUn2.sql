SELECT tblKlassenVerteilungUnElemente.Klasse, qryVerteilungElementeUn.AnzahlElemente, IIf(IsNull([AnzahlElemente]),0,[AnzahlElemente]) AS AnzahlElemente2
FROM tblKlassenVerteilungUnElemente LEFT JOIN qryVerteilungElementeUn ON tblKlassenVerteilungUnElemente.Klasse = qryVerteilungElementeUn.Klasse;
