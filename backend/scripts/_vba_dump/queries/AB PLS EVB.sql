SELECT PLS.[Enddatum der Messung], PLS.[Zeit Ende], ([PLS]![MWh Gesamtanlage]*1000)/([PLS]![Produktion]*[PLS]![Mittlere NaOH Konzentration])*100 AS [kWh/t NaOH]
FROM PLS;
