SELECT qryDatumVerteilungUn3.Elektrolyseur, Max(qryDatumVerteilungUn3.Tage) AS GewTage
FROM tblGewDaten, qryDatumVerteilungUn3
GROUP BY qryDatumVerteilungUn3.Elektrolyseur;
