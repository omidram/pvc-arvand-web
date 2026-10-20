SELECT qryMembranstatistikDOLAktiv.Membrantyp, Min(qryMembranstatistikDOLAktiv.GesamtDOL) AS MinOfGesamtDOL, Max(qryMembranstatistikDOLAktiv.GesamtDOL) AS MaxOfGesamtDOL, Avg(qryMembranstatistikDOLAktiv.GesamtDOL) AS AvgOfGesamtDOL, StDev(qryMembranstatistikDOLAktiv.GesamtDOL) AS StDevOfGesamtDOL, Count(qryMembranstatistikDOLAktiv.GesamtDOL) AS CountOfGesamtDOL
FROM qryMembranstatistikDOLAktiv
GROUP BY qryMembranstatistikDOLAktiv.Membrantyp;
