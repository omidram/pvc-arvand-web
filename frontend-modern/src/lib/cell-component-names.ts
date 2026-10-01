/** Uhde Einzelteile catalog → i18n keys (industrial EN / FA). */

const PART_KEYS: Record<string, string> = {
  "100": "cellComponents.parts.p100",
  "131": "cellComponents.parts.p131",
  "132": "cellComponents.parts.p132",
  "133": "cellComponents.parts.p133",
  "141": "cellComponents.parts.p141",
  "142": "cellComponents.parts.p142",
  "146": "cellComponents.parts.p146",
  "148": "cellComponents.parts.p148",
  "149": "cellComponents.parts.p149",
  "150": "cellComponents.parts.p150",
  "151": "cellComponents.parts.p151",
  "152": "cellComponents.parts.p152",
  "165": "cellComponents.parts.p165",
  "166": "cellComponents.parts.p166",
  "180": "cellComponents.parts.p180",
};

const NAME_KEYS: Record<string, string> = {
  zellenelement: PART_KEYS["100"],
  "cell element": PART_KEYS["100"],
  "distanzstreifen anode": PART_KEYS["131"],
  "anode spacer strip": PART_KEYS["131"],
  "distanzstreifen kathode": PART_KEYS["132"],
  "cathode spacer strip": PART_KEYS["132"],
  einsteckrohre: PART_KEYS["133"],
  einsteckrohr: PART_KEYS["133"],
  "insert pipes": PART_KEYS["133"],
  "insert pipe": PART_KEYS["133"],
  anodenflansch: PART_KEYS["141"],
  "anode flange": PART_KEYS["141"],
  kathodenflansch: PART_KEYS["142"],
  "cathode flange": PART_KEYS["142"],
  rahmendichtung: PART_KEYS["146"],
  "frame gasket": PART_KEYS["146"],
  sechskantschraube: PART_KEYS["148"],
  "hexagon bolt": PART_KEYS["148"],
  sechskantmutter: PART_KEYS["149"],
  "hexagon nut": PART_KEYS["149"],
  tellerpannscheibe: PART_KEYS["150"],
  tellerspannscheibe: PART_KEYS["150"],
  tellerfederscheibe: PART_KEYS["150"],
  "belleville washer": PART_KEYS["150"],
  isolierscheibe: PART_KEYS["151"],
  "insulating washer": PART_KEYS["151"],
  isolierhuelse: PART_KEYS["152"],
  "insulating sleeve": PART_KEYS["152"],
  blindstopfen: PART_KEYS["165"],
  "blind plug": PART_KEYS["165"],
  stopfen: PART_KEYS["166"],
  plug: PART_KEYS["166"],
  "flanschisolator satz": PART_KEYS["180"],
  flanschisolatorsatz: PART_KEYS["180"],
  "flange insulator set": PART_KEYS["180"],
};

function norm(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ");
}

export function cellComponentLabel(
  row: { part_nr?: string | null; name?: string | null },
  t: (path: string) => string,
): string {
  const partKey = PART_KEYS[(row.part_nr || "").trim()];
  if (partKey) {
    const label = t(partKey);
    if (label !== partKey) return label;
  }
  const nameKey = NAME_KEYS[norm(row.name || "")];
  if (nameKey) {
    const label = t(nameKey);
    if (label !== nameKey) return label;
  }
  return row.name || "";
}
