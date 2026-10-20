SELECT qryCEGruppe.Gruppe, qryCEGruppe.Datum, UnGruppen.[i Mittel], SPCBer([UnGruppen]![Un Mittel],[qryCEGruppe]![µNaOH]) AS Energieverbrauch, UnGruppen.[Un Mittel], qryCEGruppe.µNaOH AS CE, GetGewIRef() AS iRefSPC
FROM UnGruppen INNER JOIN qryCEGruppe ON (UnGruppen.Gruppe = qryCEGruppe.Gruppe) AND (UnGruppen.Datum = qryCEGruppe.Datum);
