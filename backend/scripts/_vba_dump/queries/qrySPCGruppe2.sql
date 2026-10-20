SELECT qryCEGruppeNaOH.Gruppe, qryCEGruppeNaOH.Datum, UnGruppen.[i Mittel], SPCBer([UnGruppen]![Un Mittel],[qryCEGruppeNaOH]![CE]) AS Energieverbrauch, UnGruppen.[Un Mittel], qryCEGruppeNaOH.CE, GetGewIRef() AS iRefSPC
FROM UnGruppen INNER JOIN qryCEGruppeNaOH ON (UnGruppen.Gruppe = qryCEGruppeNaOH.Gruppe) AND (UnGruppen.Datum = qryCEGruppeNaOH.Datum);
