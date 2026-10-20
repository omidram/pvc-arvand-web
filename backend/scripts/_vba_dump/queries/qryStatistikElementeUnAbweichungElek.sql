SELECT qryStatistikElementeUnAbweichung.Elektrolyseur, Count(qryStatistikElementeUnAbweichung.Abweichung) AS CountOfAbweichung
FROM qryStatistikElementeUnAbweichung
GROUP BY qryStatistikElementeUnAbweichung.Elektrolyseur;
