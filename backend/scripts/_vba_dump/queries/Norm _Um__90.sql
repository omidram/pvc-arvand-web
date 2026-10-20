SELECT DISTINCTROW [Norm (Um)].Elektrolyseur, [Norm (Um)].Datum, [Norm (Um)].Zeit, [Norm (Um)].[I Gesamt], [Norm (Um)].i, [Norm (Um)].Cc, [Norm (Um)].[t An], [Norm (Um)].[t Ka], [Norm (Um)].tm, [Norm (Um)].Uo, [Norm (Um)].Position, [Norm (Um)].Ui, [Norm (Um)].[Mittelwert von Ui], [Norm (Um)].Un, [Norm (Um)].ti
FROM [Norm (Um)]
WHERE ((([Norm (Um)].ti)>90))
ORDER BY [Norm (Um)].Elektrolyseur, [Norm (Um)].Datum, [Norm (Um)].Zeit, [Norm (Um)].Position;
