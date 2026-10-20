SELECT qryStatistikElementeUnAbweichung3.Elektrolyseur, Avg(qryStatistikElementeUnAbweichung3.Un) AS UnMittel
FROM qryStatistikElementeUnAbweichung3
GROUP BY qryStatistikElementeUnAbweichung3.Elektrolyseur;
