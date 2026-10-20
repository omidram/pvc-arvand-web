SELECT DISTINCTROW DOL.[Anoden Nr], Sum(DOL.DOL) AS [Summe von DOL]
FROM DOL
GROUP BY DOL.[Anoden Nr]
HAVING (((Sum(DOL.DOL))>2160));
