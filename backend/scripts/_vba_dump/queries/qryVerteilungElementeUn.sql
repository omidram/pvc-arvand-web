SELECT tblVerteilungUnElementeDetails.Klasse, Count(tblVerteilungUnElementeDetails.Klasse) AS AnzahlElemente, tblVerteilungUnElementeDetails.iRef
FROM tblVerteilungUnElementeDetails
GROUP BY tblVerteilungUnElementeDetails.Klasse, tblVerteilungUnElementeDetails.iRef;
