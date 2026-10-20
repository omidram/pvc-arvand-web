SELECT DISTINCTROW qryMembranstatistikGesamtzahl2.Membrantyp, Count(qryMembranstatistikGesamtzahl2.[Membran Nr]) AS ElementeGesamt
FROM qryMembranstatistikGesamtzahl2
GROUP BY qryMembranstatistikGesamtzahl2.Membrantyp;
