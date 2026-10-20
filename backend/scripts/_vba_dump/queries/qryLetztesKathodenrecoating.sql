SELECT tblKathodenrecoating.Kathodennummer, Max(tblKathodenrecoating.Rücklieferdatum) AS [Max von Rücklieferdatum], Count(tblKathodenrecoating.Rücklieferdatum) AS [Anzahl von Rücklieferdatum]
FROM tblKathodenrecoating
GROUP BY tblKathodenrecoating.Kathodennummer;
