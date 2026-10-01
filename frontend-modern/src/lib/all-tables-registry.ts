/** Registry describing every list-style endpoint in the system, used by the
 * "All Forms & Tables" overview page. `formKey` matches the backend's
 * per-user permission keys; "" means always visible, "__admin__" means
 * admin-only (matches backend routes protected by require_admin directly). */
export interface TableRegistryEntry {
  key: string;
  endpoint: string;
  formKey: string;
  titleKey: string;
  subtitleKey?: string;
  linkHref?: string;
}

export interface TableRegistryCategory {
  key: string;
  titleKey: string;
  entries: TableRegistryEntry[];
}

export const ALL_TABLES_REGISTRY: TableRegistryCategory[] = [
  {
    key: "elements",
    titleKey: "nav.groupElements",
    entries: [
      { key: "elements", endpoint: "/elements", formKey: "elements", titleKey: "nav.elements", linkHref: "/elements" },
      { key: "inspections", endpoint: "/inspections", formKey: "inspections", titleKey: "nav.inspections", linkHref: "/inspections" },
      {
        key: "electrode-segregations",
        endpoint: "/electrode-segregations",
        formKey: "elements",
        titleKey: "nav.segregation",
        linkHref: "/segregation",
      },
    ],
  },
  {
    key: "components",
    titleKey: "nav.groupComponents",
    entries: [
      { key: "anodes", endpoint: "/anodes", formKey: "anodes", titleKey: "nav.anodes", linkHref: "/anodes" },
      { key: "anode-maintenance", endpoint: "/anode-maintenance", formKey: "anodes", titleKey: "nav.anodes", subtitleKey: "componentTabs.maintenance" },
      { key: "anode-recoating", endpoint: "/anode-recoating", formKey: "anodes", titleKey: "nav.anodes", subtitleKey: "componentTabs.recoating" },
      { key: "anode-coating-checks", endpoint: "/anode-coating-checks", formKey: "anodes", titleKey: "nav.anodes", subtitleKey: "componentTabs.coatingChecks" },
      { key: "cathodes", endpoint: "/cathodes", formKey: "cathodes", titleKey: "nav.cathodes", linkHref: "/cathodes" },
      { key: "cathode-maintenance", endpoint: "/cathode-maintenance", formKey: "cathodes", titleKey: "nav.cathodes", subtitleKey: "componentTabs.maintenance" },
      { key: "cathode-recoating", endpoint: "/cathode-recoating", formKey: "cathodes", titleKey: "nav.cathodes", subtitleKey: "componentTabs.recoating" },
      { key: "cathode-coating-checks", endpoint: "/cathode-coating-checks", formKey: "cathodes", titleKey: "nav.cathodes", subtitleKey: "componentTabs.coatingChecks" },
      { key: "membranes", endpoint: "/membranes", formKey: "membranes", titleKey: "nav.membranes", linkHref: "/membranes" },
      { key: "membrane-maintenance", endpoint: "/membrane-maintenance", formKey: "membranes", titleKey: "nav.membranes", subtitleKey: "componentTabs.maintenance" },
    ],
  },
  {
    key: "operations",
    titleKey: "nav.groupOperations",
    entries: [
      { key: "shutdowns", endpoint: "/shutdowns", formKey: "shutdowns", titleKey: "nav.shutdowns", linkHref: "/shutdowns" },
      { key: "shutdown-categories", endpoint: "/shutdown-categories", formKey: "shutdowns", titleKey: "shutdowns.categoriesTitle" },
      { key: "shutdown-causes", endpoint: "/shutdown-causes", formKey: "shutdowns", titleKey: "shutdowns.causesTitle" },
      { key: "voltage-readings", endpoint: "/voltage-readings", formKey: "voltage", titleKey: "voltage.tabReadings", linkHref: "/voltage" },
      { key: "voltage-normalizations", endpoint: "/voltage-normalizations", formKey: "voltage", titleKey: "voltage.tabNormalizations", linkHref: "/voltage" },
      { key: "current-efficiency-entries", endpoint: "/current-efficiency-entries", formKey: "voltage", titleKey: "voltage.tabCurrentEfficiency", linkHref: "/voltage" },
      { key: "analyses", endpoint: "/analyses", formKey: "analyses", titleKey: "nav.analyses", linkHref: "/analyses" },
      { key: "remarks", endpoint: "/remarks", formKey: "remarks", titleKey: "nav.remarks", linkHref: "/remarks" },
    ],
  },
  {
    key: "settings",
    titleKey: "allTables.categorySettings",
    entries: [
      { key: "electrolyzers", endpoint: "/electrolyzers", formKey: "settings", titleKey: "settings.electrolyzer", linkHref: "/settings" },
      { key: "sub-plants", endpoint: "/sub-plants", formKey: "settings", titleKey: "settings.subPlant", linkHref: "/settings" },
      { key: "full-plants", endpoint: "/full-plants", formKey: "settings", titleKey: "settings.fullPlant", linkHref: "/settings" },
      { key: "rectifiers", endpoint: "/rectifiers", formKey: "settings", titleKey: "settings.rectifier", linkHref: "/settings" },
      { key: "transformers", endpoint: "/transformers", formKey: "settings", titleKey: "settings.transformer", linkHref: "/settings" },
      { key: "arrangements", endpoint: "/arrangements", formKey: "settings", titleKey: "settings.arrangement", linkHref: "/settings" },
      { key: "reserve-positions", endpoint: "/reserve-positions", formKey: "settings", titleKey: "settings.reservePosition", linkHref: "/settings" },
      { key: "correction-factors", endpoint: "/correction-factors", formKey: "settings", titleKey: "settings.correctionFactor", linkHref: "/settings" },
      { key: "electrode-areas", endpoint: "/electrode-areas", formKey: "settings", titleKey: "settings.electrodeArea", linkHref: "/settings" },
      { key: "voltage-distribution-classes", endpoint: "/voltage-distribution-classes", formKey: "settings", titleKey: "settings.voltageClass", linkHref: "/settings" },
      { key: "group-definitions", endpoint: "/group-definitions", formKey: "settings", titleKey: "settings.group", linkHref: "/settings" },
      { key: "inspection-reasons", endpoint: "/inspection-reasons", formKey: "settings", titleKey: "settings.inspectionReason", linkHref: "/settings" },
      { key: "inspection-findings", endpoint: "/inspection-findings", formKey: "settings", titleKey: "settings.inspectionFinding", linkHref: "/settings" },
      { key: "cell-components", endpoint: "/cell-components", formKey: "settings", titleKey: "settings.cellComponentsTitle", linkHref: "/settings" },
    ],
  },
  {
    key: "system",
    titleKey: "allTables.categorySystem",
    entries: [{ key: "users", endpoint: "/users", formKey: "__admin__", titleKey: "nav.users", linkHref: "/users" }],
  },
];
