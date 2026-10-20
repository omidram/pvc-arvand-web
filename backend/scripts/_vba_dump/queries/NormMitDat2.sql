SELECT NormMitDat1.Datum, NormMitDat1.Gruppe, Avg(NormMitDat1.Un) AS [Mittelwert von Un], [Gruppen aktiv].Membrantyp, [Gruppen aktiv].[Elektroden Abstand], [Gruppen aktiv].Anodencoating, [Gruppen aktiv].Kathodencoating, [Gruppen aktiv].Bemerkungen
FROM NormMitDat1 INNER JOIN [Gruppen aktiv] ON NormMitDat1.Gruppe = [Gruppen aktiv].Gruppe
GROUP BY NormMitDat1.Datum, NormMitDat1.Gruppe, [Gruppen aktiv].Membrantyp, [Gruppen aktiv].[Elektroden Abstand], [Gruppen aktiv].Anodencoating, [Gruppen aktiv].Kathodencoating, [Gruppen aktiv].Bemerkungen
HAVING (((NormMitDat1.Gruppe)>0));
