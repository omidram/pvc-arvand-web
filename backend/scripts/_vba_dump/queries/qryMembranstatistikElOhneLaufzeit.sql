SELECT DISTINCTROW qryMembranstatistikElOhneLaufzeit2.Membrantyp, Count(qryMembranstatistikElOhneLaufzeit2.[Membran Nr]) AS ElementeGesamt
FROM qryMembranstatistikElOhneLaufzeit2
GROUP BY qryMembranstatistikElOhneLaufzeit2.Membrantyp;
