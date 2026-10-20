SELECT tblAnodenrecoating.Anodennummer, Max(tblAnodenrecoating.Rücklieferdatum) AS [Max von Rücklieferdatum], Count(tblAnodenrecoating.Rücklieferdatum) AS [Anzahl von Rücklieferdatum]
FROM tblAnodenrecoating
GROUP BY tblAnodenrecoating.Anodennummer;
