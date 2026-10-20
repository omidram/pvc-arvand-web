SELECT DISTINCTROW Count(Montage.[Ausschalt Datum]) AS ElementePassiv, Count(Montage.[Membran Nr]) AS ElementeGesamt, Count([Einschalt Datum])-Count([Ausschalt Datum]) AS ElementeAktiv, Sum(IIf([Ausschalt Datum],[Ausschalt Datum]-[Einschalt Datum],0)) AS PassiveDOL, Sum(IIf(IsNull([Ausschalt Datum]),Date()-[Einschalt Datum],0)) AS AktiveDOL, Sum(IIf([Ausschalt Datum],[Ausschalt Datum]-[Einschalt Datum],0)+IIf(IsNull([Ausschalt Datum]),Date()-[Einschalt Datum],0)) AS GesamtDOL, Montage.[Membran Nr]
FROM Montage
GROUP BY Montage.[Membran Nr]
HAVING (((Sum(IIf([Ausschalt Datum],[Ausschalt Datum]-[Einschalt Datum],0)+IIf(IsNull([Ausschalt Datum]),Date()-[Einschalt Datum],0)))>(Select SucheRemembraning From tblGewDaten)));
