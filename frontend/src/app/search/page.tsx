"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi } from "@/lib/endpoints";
import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { DateInput } from "@/components/ui/date-input";
import { useElectrolyzerNames } from "@/components/ui/electrolyzer-combo";
import { appAlert } from "@/lib/dialog";
import { GlobalSearchPanel } from "@/components/domain/global-search-panel";

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


type Ask = { mode: "term"; kind: SearchKind } | { mode: "date"; field: string };

export default function SearchPage() {
  const { t } = useI18n();
  const electrolyzerNames = useElectrolyzerNames();
  const [kindQuery, setKindQuery] = useState<{ kind: SearchKind; q?: string } | null>(null);
  const [dateQuery, setDateQuery] = useState<{ field: string; date: string } | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [draft, setDraft] = useState("");

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

  function runKind(kind: SearchKind, q?: string) {
    setDateQuery(null);
    setKindQuery({ kind, q });
  }

  function openAsk(item: SearchBtn) {
    if (item.dateField) {
      setDraft("");
      setAsk({ mode: "date", field: item.dateField });
      return;
    }
    if (item.needsTerm && item.kind) {
      setDraft("");
      setAsk({ mode: "term", kind: item.kind });
      return;
    }
    if (item.kind) runKind(item.kind);
  }

  function submitAsk() {
    if (!ask) return;
    if (ask.mode === "term") {
      const q = draft.trim();
      if (!q) {
        void appAlert(t("search.termRequired"));
        return;
      }
      runKind(ask.kind, q);
    } else if (!draft) {
      void appAlert(t("search.pickDate"));
      return;
    } else {
      setKindQuery(null);
      setDateQuery({ field: ask.field, date: draft });
    }
    setAsk(null);
  }

  return (
    <AccessHub title={t("search.title")}>
      <GlobalSearchPanel />

      <div className="search-menu grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {SEARCH_COLUMNS.map((col, ci) => (
          <div key={ci} className="grid gap-2" style={{ gridTemplateRows: `repeat(${SEARCH_ROWS}, minmax(28px, auto))` }}>
            {col.map((item) => (
              <div key={item.labelKey} style={{ gridRow: item.row }}>
                <AccessBtn
                  onClick={() => openAsk(item)}
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
              onOpen={(row) => {
                window.location.href = `/inspections?id=${row.id}`;
              }}
            />
          )}
          {(results.segregations?.length ?? 0) > 0 && (
            <ResultCard
              title={t("search.results.segregations", { n: results.segregations?.length ?? 0 })}
              rows={results.segregations ?? []}
              keyField="id"
              onOpen={(row) => {
                const serial = String(row.serial_nr || "");
                window.location.href = `/segregation?serial_nr=${encodeURIComponent(serial)}`;
              }}
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
            results.shutdowns?.length === 0 &&
            (results.segregations?.length ?? 0) === 0 && <EmptyState title={t("common.noRecordsFound")} />}
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

      <Modal open={ask != null} onClose={() => setAsk(null)} title={ask?.mode === "date" ? t("search.date") : t("search.searchTerm")}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submitAsk();
          }}
        >
          {ask?.mode === "date" ? (
            <DateInput className="access-inset-field w-full" value={draft} onChange={(e) => setDraft(e.target.value)} />
          ) : (
            <>
              <input
                className="access-inset-field w-full"
                list="search-electrolyzer-options"
                placeholder={t("search.searchTermPlaceholder")}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                autoFocus
              />
              <datalist id="search-electrolyzer-options">
                {electrolyzerNames.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              {t("common.search")}
            </Button>
          </div>
        </form>
      </Modal>
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
  onOpen,
}: {
  title: string;
  rows: Record<string, unknown>[];
  keyField: string;
  onOpen?: (row: Record<string, unknown>) => void;
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
          <DataTable columns={columns} data={rows} keyField={keyField as never} onRowClick={onOpen} />
        )}
      </CardContent>
    </Card>
  );
}
