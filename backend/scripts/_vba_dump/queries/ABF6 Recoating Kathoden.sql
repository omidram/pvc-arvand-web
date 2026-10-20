SELECT DISTINCTROW DOL.[Kathoden Nr], Sum(DOL.DOL) AS [Summe von DOL]
FROM DOL
GROUP BY DOL.[Kathoden Nr]
HAVING (((Sum(DOL.DOL))>2160));
