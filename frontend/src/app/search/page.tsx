"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi } from "@/lib/endpoints";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { DateInput } from "@/components/ui/date-input";
import { useElectrolyzerNames } from "@/components/ui/electrolyzer-combo";

type SearchKind =
  | "element"
  | "anode"
  | "cathode"
  | "membrane"
  | "active"
  | "passive"
  | "assembly"
  | "commissioning"
  | "decommissioning"
  | "disassembly"
  | "group"
  | "dol"
  | "dol-list"
  | "inspection"
  | "inspection-code"
  | "remembraning"
  | "dup-anode"
  | "dup-cathode"
  | "dup-membrane"
  | "dup-anode-active"
  | "dup-anode-passive"
  | "dup-cathode-active"
  | "dup-cathode-passive"
  | "dup-membrane-active"
  | "dup-membrane-passive"
  | "stock-anode"
  | "stock-cathode"
  | "stock-membrane"
  | "electrolyzer"
  | "remarks"
  | "membrane-type"
  | "active-membrane-type"
  | "recoating-anode"
  | "recoating-cathode"
  | "active-groups";

type SearchBtn = {
  labelKey: string;
  kind?: SearchKind;
  dateField?: string;
  needsTerm?: boolean;
  row: number;
};

// Exact Access Suchübersicht columns (left→right) and row slots (top→bottom).
const SEARCH_COLUMNS: SearchBtn[][] = [
  [
    { row: 1, labelKey: "menus.searchElement", kind: "element", needsTerm: true },
    { row: 2, labelKey: "menus.searchActive", kind: "active" },
    { row: 3, labelKey: "menus.searchPassive", kind: "passive" },
    { row: 4, labelKey: "menus.searchDol", kind: "dol" },
    { row: 5, labelKey: "menus.searchDolList", kind: "dol-list" },
    { row: 6, labelKey: "menus.searchElectrolyzer", kind: "electrolyzer", needsTerm: true },
  ],
  [
    { row: 1, labelKey: "menus.searchAssembly", dateField: "assembly" },
    { row: 2, labelKey: "menus.searchCommissioning", dateField: "commissioning" },
    { row: 3, labelKey: "menus.searchDecommissioning", dateField: "decommissioning" },
    { row: 4, labelKey: "menus.searchDisassembly", dateField: "disassembly" },
  ],
  [
    { row: 1, labelKey: "menus.searchAssembled", kind: "assembly" },
    { row: 2, labelKey: "menus.searchCommissioned", kind: "commissioning" },
    { row: 3, labelKey: "menus.searchDecommissioned", kind: "decommissioning" },
    { row: 4, labelKey: "menus.searchDisassembled", kind: "disassembly" },
  ],
  [
    { row: 1, labelKey: "menus.searchAnode", kind: "anode", needsTerm: true },
    { row: 2, labelKey: "menus.searchAnodeInfo", kind: "anode", needsTerm: true },
    { row: 3, labelKey: "menus.searchRecoatingAnode", kind: "recoating-anode" },
    { row: 4, labelKey: "menus.searchStockAnode", kind: "stock-anode" },
    { row: 5, labelKey: "menus.searchDupAnode", kind: "dup-anode" },
    { row: 6, labelKey: "menus.searchDupAnodeActive", kind: "dup-anode-active" },
    { row: 7, labelKey: "menus.searchDupAnodePassive", kind: "dup-anode-passive" },
  ],
  [
    { row: 1, labelKey: "menus.searchCathode", kind: "cathode", needsTerm: true },
    { row: 2, labelKey: "menus.searchCathodeInfo", kind: "cathode", needsTerm: true },
    { row: 3, labelKey: "menus.searchRecoatingCathode", kind: "recoating-cathode" },
    { row: 4, labelKey: "menus.searchStockCathode", kind: "stock-cathode" },
    { row: 5, labelKey: "menus.searchDupCathode", kind: "dup-cathode" },
    { row: 6, labelKey: "menus.searchDupCathodeActive", kind: "dup-cathode-active" },
    { row: 7, labelKey: "menus.searchDupCathodePassive", kind: "dup-cathode-passive" },
  ],
  [
    { row: 1, labelKey: "menus.searchMembrane", kind: "membrane", needsTerm: true },
    { row: 2, labelKey: "menus.searchMembraneInfo", kind: "membrane", needsTerm: true },
    { row: 3, labelKey: "menus.searchRemembraning", kind: "remembraning" },
    { row: 4, labelKey: "menus.searchStockMembrane", kind: "stock-membrane" },
    { row: 5, labelKey: "menus.searchDupMembrane", kind: "dup-membrane" },
    { row: 6, labelKey: "menus.searchDupMembraneActive", kind: "dup-membrane-active" },
    { row: 7, labelKey: "menus.searchDupMembranePassive", kind: "dup-membrane-passive" },
    { row: 8, labelKey: "menus.searchMembraneType", kind: "membrane-type", needsTerm: true },
    { row: 9, labelKey: "menus.searchActiveByMembrane", kind: "active-membrane-type", needsTerm: true },
  ],
  [
    { row: 1, labelKey: "menus.searchInspection", kind: "inspection", needsTerm: true },
    { row: 2, labelKey: "menus.searchInspectionCode", kind: "inspection-code", needsTerm: true },
    { row: 4, labelKey: "menus.searchRemarks", kind: "remarks", needsTerm: true },
    { row: 6, labelKey: "menus.searchGroup", kind: "group", needsTerm: true },
    { row: 7, labelKey: "menus.searchActiveGroups", kind: "active-groups" },
  ],
];
const SEARCH_ROWS = 9;


export default function SearchPage() {
  const { t } = useI18n();
  const [term, setTerm] = useState("");
  const [date, setDate] = useState("");
  const electrolyzerNames = useElectrolyzerNames();
  const [kindQuery, setKindQuery] = useState<{ kind: SearchKind; q?: string } | null>(null);
  const [dateQuery, setDateQuery] = useState<{ field: string; date: string } | null>(null);

  const kindResult = useQuery({
    queryKey: ["search-kind", kindQuery],
    queryFn: () => searchApi.byKind(kindQuery!.kind, kindQuery!.q),
    enabled: !!kindQuery,
  });

  const byDateQuery = useQuery({
    queryKey: ["search-by-date", dateQuery],
    queryFn: () => searchApi.byDate(dateQuery!.field, dateQuery!.date),
    enabled: !!dateQuery,
  });

  const results = kindResult.data;

  function runKind(kind: SearchKind, needsTerm?: boolean) {
    if (needsTerm && !term.trim()) {
      alert(t("search.termRequired"));
      return;
    }
    setDateQuery(null);
    setKindQuery({ kind, q: term.trim() || undefined });
  }

  function runDate(field: string) {
    if (!date) {
      alert(t("search.pickDate"));
      return;
    }
    setKindQuery(null);
    setDateQuery({ field, date });
  }

  return (
    <AccessHub title={t("search.title")}>
      <div className="search-filters mb-3 flex flex-wrap items-end gap-3 text-[12px]">
        <label className="inline-flex min-w-0 flex-1 items-center gap-1 sm:flex-none">
          {t("search.searchTerm")}
          <input
            className="access-inset-field w-full min-w-0 sm:w-[220px]"
            list="search-electrolyzer-options"
            placeholder={t("search.searchTermPlaceholder")}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && term.trim()) runKind("element", true);
            }}
          />
          <datalist id="search-electrolyzer-options">
            {electrolyzerNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </label>
        <label className="inline-flex min-w-0 items-center gap-1">
          {t("search.date")}
          <DateInput className="access-inset-field w-full min-w-0 sm:w-[140px]" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      <div className="search-menu grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {SEARCH_COLUMNS.map((col, ci) => (
          <div key={ci} className="grid gap-2" style={{ gridTemplateRows: `repeat(${SEARCH_ROWS}, minmax(28px, auto))` }}>
            {col.map((item) => (
              <div key={item.labelKey} style={{ gridRow: item.row }}>
                <AccessBtn
                  onClick={() => (item.dateField ? runDate(item.dateField) : runKind(item.kind!, item.needsTerm))}
                >
                  {t(item.labelKey)}
                </AccessBtn>
              </div>
            ))}
          </div>
        ))}
      </div>

      {kindResult.isLoading && <LoadingState />}
      {kindResult.isError && <ErrorState message={(kindResult.error as Error).message} />}
      {byDateQuery.isLoading && <LoadingState />}
      {byDateQuery.isError && <ErrorState message={(byDateQuery.error as Error).message} />}

      {results && (
        <div className="mt-3 mb-2 text-xs font-bold text-[var(--win-navy)]">{results.title || kindQuery?.kind}</div>
      )}

      {results && (
        <div className="mt-3 flex min-w-0 flex-col gap-4">
          {(results.elements?.length ?? 0) > 0 && (
            <ResultCard title={t("search.results.elements", { n: results.elements.length })} rows={results.elements} keyField="id" />
          )}
          {(results.anodes?.length ?? 0) > 0 && (
            <ResultCard title={t("search.results.anodes", { n: results.anodes.length })} rows={results.anodes} keyField="anode_nr" />
          )}
          {(results.cathodes?.length ?? 0) > 0 && (
            <ResultCard title={t("search.results.cathodes", { n: results.cathodes.length })} rows={results.cathodes} keyField="cathode_nr" />
          )}
          {(results.membranes?.length ?? 0) > 0 && (
            <ResultCard
              title={t("search.results.membranes", { n: results.membranes.length })}
              rows={results.membranes}
              keyField="membrane_nr"
            />
          )}
          {(results.inspections?.length ?? 0) > 0 && (
            <ResultCard
              title={t("search.results.inspections", { n: results.inspections.length })}
              rows={results.inspections}
              keyField="id"
            />
          )}
          {(results.shutdowns?.length ?? 0) > 0 && (
            <ResultCard title={t("search.results.shutdowns", { n: results.shutdowns.length })} rows={results.shutdowns} keyField="nr" />
          )}
          {results.elements?.length === 0 &&
            results.anodes?.length === 0 &&
            results.cathodes?.length === 0 &&
            results.membranes?.length === 0 &&
            results.inspections?.length === 0 &&
            results.shutdowns?.length === 0 && <EmptyState title={t("common.noRecordsFound")} />}
        </div>
      )}

      {dateQuery && !byDateQuery.isLoading ? (
        <div className="mt-4">
          <DataTable
            columns={[
              { key: "element_nr", header: t("fields.elementNr") },
              { key: "electrolyzer", header: t("fields.electrolyzer") },
              { key: "position", header: t("fields.position") },
              {
                key: "assembly_date",
                header: t("fields.assemblyDate"),
                render: (r) => formatDate(String(r.assembly_date || "")),
              },
            ]}
            data={byDateQuery.data as Record<string, unknown>[] | undefined}
            keyField="id"
            emptyTitle={t("search.noDateMatches")}
          />
        </div>
      ) : null}
    </AccessHub>
  );
}

function formatCell(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return formatDate(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ResultCard({
  title,
  rows,
  keyField,
}: {
  title: string;
  rows: Record<string, unknown>[];
  keyField: string;
}) {
  const { t } = useI18n();
  const columns = Object.keys(rows[0] || {}).map((key) => ({
    key,
    header: key,
    render: (r: Record<string, unknown>) => formatCell(r[key]),
  }));

  return (
    <Card className="min-w-0 max-w-full">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        {rows.length === 0 ? (
          <EmptyState title={t("common.noRecordsFound")} />
        ) : (
          <DataTable columns={columns} data={rows} keyField={keyField as never} />
        )}
      </CardContent>
    </Card>
  );
}
