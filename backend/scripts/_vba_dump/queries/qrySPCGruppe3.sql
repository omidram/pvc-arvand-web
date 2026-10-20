SELECT qryCEGruppe.Gruppe, qryCEGruppe.Datum, qryUnGruppe2.i AS [i Mittel], SPCBer([qryUnGruppe2]![Un],[qryCEGruppe]![µNaOH]) AS Energieverbrauch, qryUnGruppe2.Un AS [Un Mittel], qryCEGruppe.µNaOH AS CE, GetGewIRef() AS iRefSPC
FROM qryUnGruppe2 INNER JOIN qryCEGruppe ON (qryUnGruppe2.Datum = qryCEGruppe.Datum) AND (qryUnGruppe2.Gruppe = qryCEGruppe.Gruppe);
