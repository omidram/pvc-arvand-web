SELECT qryCEGruppeNaOH.Gruppe, qryCEGruppeNaOH.Datum, qryUnGruppe2.i AS [i Mittel], SPCBer([qryUnGruppe2]![Un],[qryCEGruppeNaOH]![CE]) AS Energieverbrauch, qryUnGruppe2.Un AS [Un Mittel], qryCEGruppeNaOH.CE, GetGewIRef() AS iRefSPC
FROM qryCEGruppe, qryUnGruppe2 INNER JOIN qryCEGruppeNaOH ON (qryUnGruppe2.Datum = qryCEGruppeNaOH.Datum) AND (qryUnGruppe2.Gruppe = qryCEGruppeNaOH.Gruppe);
