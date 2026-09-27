"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { searchApi } from "@/lib/endpoints";
import { PageHeader } from "@/components/ui/page-header";
import { Input, Select, Label } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";

export default function SearchPage() {
  const { t } = useI18n();
  const DATE_FIELDS = [
    { label: t("search.fieldAssemblyDate"), value: "assembly" },
    { label: t("search.fieldCommissioningDate"), value: "commissioning" },
    { label: t("search.fieldDecommissioningDate"), value: "decommissioning" },
    { label: t("search.fieldDisassemblyDate"), value: "disassembly" },
  ];

  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");

  const [dateField, setDateField] = useState("assembly");
  const [date, setDate] = useState("");
  const [dateQuery, setDateQuery] = useState<{ field: string; date: string } | null>(null);

  const searchQuery = useQuery({
    queryKey: ["search", query],
    queryFn: () => searchApi.all(query),
    enabled: !!query,
  });

  const byDateQuery = useQuery({
    queryKey: ["search-by-date", dateQuery],
    queryFn: () => searchApi.byDate(dateQuery!.field, dateQuery!.date),
    enabled: !!dateQuery,
  });

  const results = searchQuery.data;

  return (
    <div>
      <PageHeader title={t("search.title")} description={t("search.description")} helpKey="search" />

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-end gap-3 py-4">
          <div className="min-w-[280px] flex-1">
            <Label>{t("search.searchTerm")}</Label>
            <Input
              placeholder={t("search.searchTermPlaceholder")}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setQuery(term)}
            />
          </div>
          <Button onClick={() => setQuery(term)} disabled={!term}>
            <SearchIcon size={16} /> {t("common.search")}
          </Button>
        </CardContent>
      </Card>

      {searchQuery.isLoading && <LoadingState />}
      {searchQuery.isError && <ErrorState message={(searchQuery.error as Error).message} />}

      {results && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ResultCard title={t("search.results.elements", { n: results.elements.length })} rows={results.elements} keyField="id" />
          <ResultCard title={t("search.results.anodes", { n: results.anodes.length })} rows={results.anodes} keyField="anode_nr" />
          <ResultCard title={t("search.results.cathodes", { n: results.cathodes.length })} rows={results.cathodes} keyField="cathode_nr" />
          <ResultCard title={t("search.results.membranes", { n: results.membranes.length })} rows={results.membranes} keyField="membrane_nr" />
          <ResultCard title={t("search.results.shutdowns", { n: results.shutdowns.length })} rows={results.shutdowns} keyField="nr" />
          <ResultCard title={t("search.results.inspections", { n: results.inspections.length })} rows={results.inspections} keyField="id" />
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>{t("search.byDateTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label>{t("search.dateField")}</Label>
              <Select value={dateField} onChange={(e) => setDateField(e.target.value)} className="min-w-[200px]">
                {DATE_FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t("search.date")}</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <Button onClick={() => setDateQuery({ field: dateField, date })} disabled={!date}>
              <SearchIcon size={16} /> {t("common.search")}
            </Button>
          </div>
          {byDateQuery.isLoading ? (
            <LoadingState />
          ) : byDateQuery.isError ? (
            <ErrorState message={(byDateQuery.error as Error).message} />
          ) : dateQuery ? (
            <DataTable
              columns={[
                { key: "element_nr", header: t("fields.elementNr") },
                { key: "electrolyzer", header: t("fields.electrolyzer") },
                { key: "position", header: t("fields.position") },
              ]}
              data={byDateQuery.data}
              keyField="id"
              emptyTitle={t("search.noDateMatches")}
            />
          ) : (
            <EmptyState title={t("search.pickDate")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
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
  const columns = rows.length > 0 ? Object.keys(rows[0]).map((k) => ({ key: k, header: k, render: (r: Record<string, unknown>) => {
    const v = r[k];
    if (v === null || v === undefined) return "—";
    if (k.toLowerCase().includes("date") || k.toLowerCase().includes("time")) return formatDate(String(v));
    return String(v);
  } })) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <DataTable columns={columns} data={rows} keyField={keyField} emptyTitle={t("search.noMatches")} />
      </CardContent>
    </Card>
  );
}
