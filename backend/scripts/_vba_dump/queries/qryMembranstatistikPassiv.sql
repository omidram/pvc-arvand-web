SELECT qryMembranstatistikDOLPassiv.Membrantyp, Min(qryMembranstatistikDOLPassiv.GesamtDOL) AS MinOfGesamtDOL, Max(qryMembranstatistikDOLPassiv.GesamtDOL) AS MaxOfGesamtDOL, Avg(qryMembranstatistikDOLPassiv.GesamtDOL) AS AvgOfGesamtDOL, StDev(qryMembranstatistikDOLPassiv.GesamtDOL) AS StDevOfGesamtDOL, Count(qryMembranstatistikDOLPassiv.GesamtDOL) AS CountOfGesamtDOL
FROM qryMembranstatistikDOLPassiv
GROUP BY qryMembranstatistikDOLPassiv.Membrantyp;
