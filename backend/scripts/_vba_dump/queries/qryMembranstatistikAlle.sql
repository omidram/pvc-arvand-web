SELECT qryMembranstatistikDOLAlle.Membrantyp, Min(qryMembranstatistikDOLAlle.GesamtDOL) AS MinOfGesamtDOL, Max(qryMembranstatistikDOLAlle.GesamtDOL) AS MaxOfGesamtDOL, Avg(qryMembranstatistikDOLAlle.GesamtDOL) AS AvgOfGesamtDOL, StDev(qryMembranstatistikDOLAlle.GesamtDOL) AS StDevOfGesamtDOL, Count(qryMembranstatistikDOLAlle.GesamtDOL) AS CountOfGesamtDOL
FROM qryMembranstatistikDOLAlle
GROUP BY qryMembranstatistikDOLAlle.Membrantyp;
