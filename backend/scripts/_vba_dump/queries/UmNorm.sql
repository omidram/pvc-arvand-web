SELECT DISTINCTROW Um.Elektrolyseur, Um.Datum, Um.Zeit, Um.[Mittelwert von Ui], [Um]![Uo]+(3/[Um]![i])*([Um]![Mittelwert von Ui]-[Um]![Uo])-([Um]![i]/3)*(90-[Um]![tm])*0.01+([Um]![i]/3)*(32-[Um]![Cc])*0.02 AS Un
FROM Um
GROUP BY Um.Elektrolyseur, Um.Datum, Um.Zeit, Um.[Mittelwert von Ui], [Um]![Uo]+(3/[Um]![i])*([Um]![Mittelwert von Ui]-[Um]![Uo])-([Um]![i]/3)*(90-[Um]![tm])*0.01+([Um]![i]/3)*(32-[Um]![Cc])*0.02;
