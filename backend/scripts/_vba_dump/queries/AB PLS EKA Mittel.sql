SELECT [AB PLS EA Mittel].Datum, [AB PLS EA Mittel]![EA Mittel]-7*(90-([PLS]![Mittlere Katholyttemperatur]+[PLS]![Mittlere Anolyttemperatur])/2)-6*([AB PLS Produktion]![CE]-[PLS]![Garantierter Stromverbrauch])-14*([PLS]![Mittlere NaOH Konzentration]-32) AS [EKA Mittel]
FROM [AB PLS EA Mittel], [AB PLS Produktion], PLS;
