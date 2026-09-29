import { ACCESS_FORM_NAMES } from "@/lib/access-form-names";
import { accessFormEnglishLabel } from "@/lib/access-form-labels";

export type AccessFormShortcut = {
  name: string;
  label: string;
  href: string;
  formKey: string;
  kind: "form" | "subform" | "other";
};

type Route = { href: string; formKey: string };

const ANALYSIS_TYPE: Record<string, string> = {
  anolyt: "anolyte",
  katholyt: "catholyte",
  reinsole: "pure_brine",
  chlorgas: "chlorine_gas",
  hydrogen: "hydrogen",
  hcl: "hcl",
  deminwater: "demin_water",
  "caustic feed": "caustic_feed",
};

const ANALYSIS_SCOPE: Record<string, string> = {
  gesamt: "plant",
  teilanlage: "sub_plant",
  gruppe: "group",
  element: "element",
};

const EXACT: Record<string, Route> = {
  Header: { href: "/", formKey: "" },
  Analyse: { href: "/analyses", formKey: "analyses" },
  "Anodische Bilanz": { href: "/analyses", formKey: "analyses" },
  Betriebsdaten: { href: "/voltage", formKey: "voltage" },
  DOL: { href: "/statistics?form=dol", formKey: "statistics" },
  "Datenerfassung Elektrolyseure": { href: "/voltage?form=input-electrolyzer", formKey: "voltage" },
  "Datenerfassung Elemente": { href: "/voltage?form=input-elements", formKey: "voltage" },
  DiaGruppe: { href: "/voltage", formKey: "voltage" },
  DiaUnCEA: { href: "/un-ce", formKey: "reports" },
  Einzelteile: { href: "/elements/components", formKey: "elements" },
  Energieverbrauch: { href: "/power-consumption", formKey: "statistics" },
  Formular1: { href: "/", formKey: "" },
  "Gesamt Norm >90": { href: "/voltage", formKey: "voltage" },
  "Gesamt Normierung": { href: "/voltage", formKey: "voltage" },
  Gruppen: { href: "/settings?tab=groups", formKey: "settings" },
  "Gruppen Übersicht": { href: "/settings?tab=groups", formKey: "settings" },
  Gruppenmerkmale: { href: "/settings?tab=groups", formKey: "settings" },
  ListGrGes: { href: "/settings?tab=groups", formKey: "settings" },
  "Norm(Um)AlleDatum": { href: "/voltage?form=normalizations", formKey: "voltage" },
  "Norm(Um)DatMittel": { href: "/voltage?form=normalizations", formKey: "voltage" },
  "Norm(Um)ElekDatum": { href: "/voltage?form=normalizations", formKey: "voltage" },
  NormElekGes: { href: "/voltage?form=normalizations", formKey: "voltage" },
  "Recoating Anoden": { href: "/anodes", formKey: "anodes" },
  "Recoating Kathoden": { href: "/cathodes", formKey: "cathodes" },
  Remembraning: { href: "/membranes", formKey: "membranes" },
  Spannug2: { href: "/voltage", formKey: "voltage" },
  Suchübersicht: { href: "/search", formKey: "search" },
  Um: { href: "/voltage", formKey: "voltage" },
  UnCE: { href: "/un-ce", formKey: "reports" },
  "An StromAusGes": { href: "/analyses", formKey: "analyses" },
  frmAboutEAP: { href: "/about", formKey: "" },
  frmAbschaltungen: { href: "/shutdowns?form=list", formKey: "shutdowns" },
  frmAbschaltungenZeitraum: { href: "/shutdowns?form=period", formKey: "shutdowns" },
  frmAbschaltungsUrsachen: { href: "/shutdowns?form=reasons", formKey: "shutdowns" },
  frmAbschaltungskategorien: { href: "/shutdowns?form=categories", formKey: "shutdowns" },
  frmAbschaltungszusammenfassung: { href: "/shutdowns?form=summary-reason", formKey: "shutdowns" },
  frmAbschaltungszusammenfassungKategorie: { href: "/shutdowns?form=summary-category", formKey: "shutdowns" },
  frmAnalyseAnolytEinlesen: { href: "/analyses", formKey: "analyses" },
  frmAnalyseHClElektrolyseur: { href: "/analyses?type=hcl&scope=electrolyzer", formKey: "analyses" },
  frmAnalyseHClGesamtanlage: { href: "/analyses?type=hcl&scope=plant", formKey: "analyses" },
  frmAnalyseHClTeilanlage: { href: "/analyses?type=hcl&scope=sub_plant", formKey: "analyses" },
  frmAnalysenEinlesen: { href: "/analyses", formKey: "analyses" },
  frmAnodencoatingpruefung: { href: "/anodes?tab=coating", formKey: "anodes" },
  frmAnodendetails: { href: "/anodes", formKey: "anodes" },
  frmAnodeninstandhaltung: { href: "/anodes?tab=maintenance", formKey: "anodes" },
  frmAnodenrecoating: { href: "/anodes?tab=recoating", formKey: "anodes" },
  frmAnordnung: { href: "/arrangement", formKey: "settings" },
  frmBemerkungen: { href: "/remarks", formKey: "remarks" },
  frmDateneinlesenElemente: { href: "/voltage?form=readings", formKey: "voltage" },
  frmDateneinlesenElementeAlt: { href: "/voltage?form=readings", formKey: "voltage" },
  frmEingabeUnElement: { href: "/voltage?form=input-single", formKey: "voltage" },
  frmEingabeUnGruppe: { href: "/voltage?form=input-group", formKey: "voltage" },
  frmEinstellungen: { href: "/settings", formKey: "settings" },
  frmElementinspektion: { href: "/inspections", formKey: "inspections" },
  frmEnergieverbrauchDurchschnitt: { href: "/power-consumption", formKey: "statistics" },
  frmImportDemontagedaten: { href: "/elements/assembly?import=demontage", formKey: "elements" },
  frmImportMontagedaten: { href: "/elements/assembly?import=montage", formKey: "elements" },
  "Electrode Segregation (TAFKIK)": { href: "/segregation", formKey: "anodes" },
  TAFKIK: { href: "/segregation", formKey: "anodes" },
  frmInspektionsBerichtAlt: { href: "/inspections", formKey: "inspections" },
  frmInspektionsbericht: { href: "/inspections", formKey: "inspections" },
  frmInspektionsberichtBefunde: { href: "/inspections", formKey: "inspections" },
  frmInspektionsberichtTest: { href: "/inspections", formKey: "inspections" },
  frmInspektionsgruende: { href: "/settings?tab=inspection-reasons", formKey: "settings" },
  frmInspektionsgruende2: { href: "/settings?tab=inspection-reasons", formKey: "settings" },
  frmInspektionsgruendeMontage: { href: "/settings?tab=inspection-reasons", formKey: "settings" },
  frmInspektionsprotokollMembranAS: { href: "/inspections", formKey: "inspections" },
  frmKathodencoatingpruefung: { href: "/cathodes?tab=coating", formKey: "cathodes" },
  frmKathodendetails: { href: "/cathodes", formKey: "cathodes" },
  frmKathodeninstandhaltung: { href: "/cathodes?tab=maintenance", formKey: "cathodes" },
  frmKathodenrecoating: { href: "/cathodes?tab=recoating", formKey: "cathodes" },
  frmLagerbestandAnoden: { href: "/storage", formKey: "storage" },
  frmLagerbestandKathoden: { href: "/storage", formKey: "storage" },
  frmLagerbestandMembranen: { href: "/storage", formKey: "storage" },
  frmMembrandetails: { href: "/membranes", formKey: "membranes" },
  frmMembrandetails2: { href: "/membranes", formKey: "membranes" },
  frmMembraninstandhaltung: { href: "/membranes?tab=maintenance", formKey: "membranes" },
  frmMembranstatistik: { href: "/statistics?form=dol", formKey: "statistics" },
  frmMenuAbschaltungen: { href: "/shutdowns", formKey: "shutdowns" },
  frmMenuStatistik: { href: "/statistics", formKey: "statistics" },
  frmMontagedaten: { href: "/elements/assembly", formKey: "elements" },
  frmMontagedatenSuchergebnis: { href: "/search", formKey: "search" },
  frmReinstsoleAnUebertragen: { href: "/analyses?type=pure_brine&scope=plant", formKey: "analyses" },
  frmStatistikAbweichungUn: { href: "/statistics?form=voltages", formKey: "statistics" },
  frmStatistikVerteilungUN: { href: "/statistics?form=distribution", formKey: "statistics" },
  frmTabelleLeistungstests: { href: "/test-run-results", formKey: "voltage" },
  frmTabelleSPC: { href: "/statistics?form=distribution", formKey: "statistics" },
  frmZellenverwaltung: { href: "/elements", formKey: "elements" },
};

function analysisRoute(name: string): Route | null {
  if (!name.startsWith("An ")) return null;
  const rest = name.slice(3);
  const parts = rest.split(" ");
  let scopeToken = "";
  const last = parts[parts.length - 1]?.toLowerCase() ?? "";
  if (ANALYSIS_SCOPE[last]) {
    scopeToken = last;
    parts.pop();
  }
  const typeKey = parts.join(" ").toLowerCase();
  const type = ANALYSIS_TYPE[typeKey];
  if (!type) return { href: "/analyses", formKey: "analyses" };
  const scope = ANALYSIS_SCOPE[scopeToken] || (type === "hydrogen" || type === "demin_water" ? "plant" : "electrolyzer");
  return { href: `/analyses?type=${type}&scope=${scope}`, formKey: "analyses" };
}

function patternRoute(name: string): Route {
  const n = name.toLowerCase();

  if (n.includes("suche") || n.includes("suchergebnis") || n.startsWith("such")) {
    return { href: "/search", formKey: "search" };
  }
  if (n.includes("abschalt")) {
    if (n.includes("ursach") || n.includes("reason")) return { href: "/shutdowns?form=reasons", formKey: "shutdowns" };
    if (n.includes("kategor") && n.includes("zusammen")) return { href: "/shutdowns?form=summary-category", formKey: "shutdowns" };
    if (n.includes("kategor")) return { href: "/shutdowns?form=categories", formKey: "shutdowns" };
    if (n.includes("zeitraum") || n.includes("period")) return { href: "/shutdowns?form=period", formKey: "shutdowns" };
    if (n.includes("zusammen")) return { href: "/shutdowns?form=summary-reason", formKey: "shutdowns" };
    if (n.includes("menu")) return { href: "/shutdowns", formKey: "shutdowns" };
    return { href: "/shutdowns?form=list", formKey: "shutdowns" };
  }
  if (n.includes("bemerkung")) return { href: "/remarks", formKey: "remarks" };
  if (n.includes("leistungstest") || n.includes("test run")) return { href: "/test-run-results", formKey: "voltage" };
  if (n.includes("unce") || n.includes("un-ce") || n.includes("unce")) return { href: "/un-ce", formKey: "reports" };
  if (n.includes("energieverbrauch") || n.includes("power")) return { href: "/power-consumption", formKey: "statistics" };
  if (n.includes("diagrammce") || n.includes("tabellece") || n.includes("eingabece") || n.includes("current efficiency")) {
    return { href: "/current-efficiency", formKey: "voltage" };
  }
  if (n.includes("spc") || n.includes("verteilung") || n.includes("statistik") || n.includes("abweichung") || n.includes("dol")) {
    return { href: "/statistics", formKey: "statistics" };
  }
  if (n.includes("diagrammun") || n.includes("tabelleun") || n.includes("eingabeun") || n.includes("stdvoltage") || n.includes("spannung") || n.includes("norm(") || n === "um") {
    return { href: "/voltage", formKey: "voltage" };
  }
  if (n.includes("analyse") || n.includes("anolyt") || n.includes("katholyt") || n.includes("reinsole") || n.includes("chlorgas")) {
    return { href: "/analyses", formKey: "analyses" };
  }
  if (n.includes("tafkik") || n.includes("segregation") || n.includes("تفکیک")) {
    return { href: "/segregation", formKey: "anodes" };
  }
  if (n.includes("anoden")) return { href: "/anodes", formKey: "anodes" };
  if (n.includes("kathoden")) return { href: "/cathodes", formKey: "cathodes" };
  if (n.includes("membran")) return { href: "/membranes", formKey: "membranes" };
  if (n.includes("inspektion")) return { href: "/inspections", formKey: "inspections" };
  if (n.includes("anordnung") || n.includes("gruppe") || n.includes("einstellung") || n.includes("sprache") || n.includes("kunde") || n.includes("anlage") || n.includes("gleichrichter") || n.includes("transformator") || n.includes("reserve") || n.includes("korrektur") || n.includes("flaeche") || n.includes("einzelteil")) {
    return { href: "/settings", formKey: "settings" };
  }
  if (n.includes("montage") || n.includes("zellen") || n.includes("element") || n.includes("elektrolyseur")) {
    return { href: "/elements", formKey: "elements" };
  }
  if (n.includes("import") || n.includes("datei") || n.includes("verzeichnis") || n.includes("einlesen")) {
    return { href: "/settings?tab=import-export", formKey: "import_export" };
  }
  return { href: "/", formKey: "" };
}

export function resolveAccessForm(name: string): Route {
  if (EXACT[name]) return EXACT[name];
  const analysis = analysisRoute(name);
  if (analysis) return analysis;
  return patternRoute(name);
}

function kindOf(name: string): AccessFormShortcut["kind"] {
  const lower = name.toLowerCase();
  if (lower.startsWith("subfrm")) return "subform";
  if (lower.startsWith("tbl")) return "other";
  return "form";
}

export function getAccessFormShortcuts(): AccessFormShortcut[] {
  return ACCESS_FORM_NAMES.map((name) => {
    const route = resolveAccessForm(name);
    return {
      name,
      label: accessFormEnglishLabel(name),
      href: route.href,
      formKey: route.formKey,
      kind: kindOf(name),
    };
  });
}
