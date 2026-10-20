SELECT [Suche aktive Elemente alle AB].Gruppe, [Suche aktive Elemente alle AB].Membrantyp, [Suche aktive Elemente alle AB].[Elektroden Abstand], Count([Suche aktive Elemente alle AB].[Element Nr]) AS [Anzahl von Element Nr], Gruppenmerkmale.Bemerkungen, Gruppenmerkmale.Anodencoating, Gruppenmerkmale.Kathodencoating
FROM [Suche aktive Elemente alle AB] INNER JOIN Gruppenmerkmale ON [Suche aktive Elemente alle AB].Gruppe = Gruppenmerkmale.Gruppe
GROUP BY [Suche aktive Elemente alle AB].Gruppe, [Suche aktive Elemente alle AB].Membrantyp, [Suche aktive Elemente alle AB].[Elektroden Abstand], Gruppenmerkmale.Bemerkungen, Gruppenmerkmale.Anodencoating, Gruppenmerkmale.Kathodencoating
HAVING ((([Suche aktive Elemente alle AB].Gruppe)>0));
