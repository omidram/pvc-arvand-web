/** Uhde inspection-reason catalog → i18n keys (industrial EN / FA). */

const KEYS: Record<string, string> = {
  "deformation wanne": "inspectionReasons.deformationPan",
  "deformation pan": "inspectionReasons.deformationPan",
  "deformation elektrode": "inspectionReasons.deformationElectrode",
  "deformation electrode": "inspectionReasons.deformationElectrode",
  verfaerbungen: "inspectionReasons.coloredArea",
  "colored area": "inspectionReasons.coloredArea",
  "korrosion wanne": "inspectionReasons.corrosionPan",
  "corrosion pan": "inspectionReasons.corrosionPan",
  "korrosion elektrode": "inspectionReasons.corrosionElectrode",
  "corrosion electrode": "inspectionReasons.corrosionElectrode",
  ablagerungen: "inspectionReasons.deposits",
  deposits: "inspectionReasons.deposits",
  "leckage rueckwand": "inspectionReasons.leakagePan",
  "leakage pan": "inspectionReasons.leakagePan",
  "leckager lasernaht": "inspectionReasons.leakageWebArea",
  "leckage lasernaht": "inspectionReasons.leakageWebArea",
  "leakage web area": "inspectionReasons.leakageWebArea",
  "leckage ecknaht": "inspectionReasons.leakageCornerArea",
  "leakage corner area": "inspectionReasons.leakageCornerArea",
  "leckage auslaufrohr flansch": "inspectionReasons.leakageOutletNozzle",
  "leakage outlet nozzle flange": "inspectionReasons.leakageOutletNozzle",
  "leckage zulaufrohr": "inspectionReasons.leakageInletNozzle",
  "leakage inlet nozzle": "inspectionReasons.leakageInletNozzle",
  "spannung hoch": "inspectionReasons.voltageHigh",
  "voltage high": "inspectionReasons.voltageHigh",
  "spannung tief": "inspectionReasons.voltageLow",
  "voltage low": "inspectionReasons.voltageLow",
  "membrantest 1": "inspectionReasons.membraneTest1",
  "membrane test 1": "inspectionReasons.membraneTest1",
  "membrantest 2": "inspectionReasons.membraneTest2",
  "membrane test 2": "inspectionReasons.membraneTest2",
  remembraning: "inspectionReasons.remembraning",
  "recoating kathode": "inspectionReasons.recoatingCathode",
  "recoating cathode": "inspectionReasons.recoatingCathode",
  "recoating anode": "inspectionReasons.recoatingAnode",
  "hoher wasserstoffgehalt": "inspectionReasons.highHydrogen",
  "high hydrogen concentration": "inspectionReasons.highHydrogen",
  anode: "inspectionReasons.anode",
  kathode: "inspectionReasons.cathode",
  cathode: "inspectionReasons.cathode",
  "leckage verschraubung": "inspectionReasons.leakageBolt",
  "leakage bolt": "inspectionReasons.leakageBolt",
  "leckage dichtung": "inspectionReasons.leakageGasket",
  "leakage gasket": "inspectionReasons.leakageGasket",
  routineuntersuchung: "inspectionReasons.routineInspection",
  "routine inspection": "inspectionReasons.routineInspection",
  "leckage auslaufschlauch": "inspectionReasons.leakageOutletHose",
  "leakage outlet hose": "inspectionReasons.leakageOutletHose",
  "leckage zulaufschlauch": "inspectionReasons.inletHoseLeak",
  "inlet hose leak": "inspectionReasons.inletHoseLeak",
  "leakage inlet hose": "inspectionReasons.inletHoseLeak",
  "schutzelektrode geschweisst": "inspectionReasons.protectionWelded",
  "protection electrode welded": "inspectionReasons.protectionWelded",
  "schutzelektrode geschraubt": "inspectionReasons.protectionNonWelded",
  "protection electrode non welded": "inspectionReasons.protectionNonWelded",
  "leckage schweissnaht": "inspectionReasons.leakageWelding",
  "leakage at welding": "inspectionReasons.leakageWelding",
  membran: "inspectionReasons.membrane",
  membrane: "inspectionReasons.membrane",
  standrohr: "inspectionReasons.standpipe",
  standpipe: "inspectionReasons.standpipe",
  elementverschraubung: "inspectionReasons.elementBolting",
  "element bolting": "inspectionReasons.elementBolting",
  schweissfehler: "inspectionReasons.weldDefect",
  "weld defect": "inspectionReasons.weldDefect",
  elektrolytschlauch: "inspectionReasons.electrolyteHose",
  "electrolyte hose": "inspectionReasons.electrolyteHose",
  zulaufschlauch: "inspectionReasons.inletHose",
  "inlet hose": "inspectionReasons.inletHose",
};

function norm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[/_\-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function inspectionReasonLabel(reason: string | null | undefined, t: (path: string) => string): string {
  if (!reason) return "";
  const key = KEYS[norm(reason)];
  if (key) {
    const label = t(key);
    if (label !== key) return label;
  }
  return reason;
}
