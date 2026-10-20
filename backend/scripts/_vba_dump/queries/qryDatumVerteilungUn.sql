SELECT qryDatumVerteilungUn2.Elektrolyseur, qryDatumVerteilungUn2.GewTage, [DatumVerteilungUN]+[GewTage] AS GewDatum
FROM tblGewDaten, qryDatumVerteilungUn2;
