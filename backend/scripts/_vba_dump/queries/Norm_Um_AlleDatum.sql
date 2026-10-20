SELECT [Norm(Um)Alle].Gruppe, [Norm(Um)Alle].Elektrolyseur, [Norm(Um)Alle].Datum, Avg([Norm(Um)Alle].Un) AS [Mittelwert von Un1], [Norm(Um)Alle].Membrantyp, Avg([Norm(Um)Alle].[I Gesamt]) AS [Mittelwert von I Gesamt], [Gruppen aktiv].[Elektroden Abstand], Count([Gruppen aktiv].[Anzahl von Element Nr]) AS [Anzahl von Anzahl von Element Nr], [Gruppen aktiv].Anodencoating, [Gruppen aktiv].Kathodencoating
FROM [Norm(Um)Alle] INNER JOIN [Gruppen aktiv] ON [Norm(Um)Alle].Gruppe = [Gruppen aktiv].Gruppe
GROUP BY [Norm(Um)Alle].Gruppe, [Norm(Um)Alle].Elektrolyseur, [Norm(Um)Alle].Datum, [Norm(Um)Alle].Membrantyp, [Gruppen aktiv].[Elektroden Abstand], [Gruppen aktiv].Anodencoating, [Gruppen aktiv].Kathodencoating
HAVING ((([Norm(Um)Alle].Datum)=[Select]![Date?]))
ORDER BY [Norm(Um)Alle].Gruppe;
