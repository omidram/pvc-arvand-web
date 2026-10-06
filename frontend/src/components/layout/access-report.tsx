"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn, AccessGroup, AccessRadio } from "@/components/layout/access-hub";
import { formatDisplayedDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";

export type RadioGroupDef = {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  /** Rendered directly under the currently selected option (Access subform slot). */
  extra?: (value: string) => React.ReactNode;
};

export type AccessTableColumn = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  /** Format cell; dates use formatDisplayedDate by default when key hints date. */
  format?: (value: unknown, row: Record<string, unknown>) => string;
};

export function ReportColumn({
  title,
  groups,
  values,
  onChange,
  onDisplay,
}: {
  title: string;
  groups: RadioGroupDef[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
  onDisplay: () => void;
}) {
  const { t } = useI18n();
  const bodyGroups = groups.filter((g) => g.name !== "result");
  const resultGroup = groups.find((g) => g.name === "result");

  function renderGroup(group: RadioGroupDef) {
    const selected = values[group.name];
    return (
      <AccessGroup key={group.name} legend={group.legend}>
        {group.options.map((opt) => (
          <div key={opt.value}>
            <AccessRadio
              name={`${title}-${group.name}`}
              value={opt.value}
              checked={selected === opt.value}
              onChange={(v) => onChange(group.name, v)}
              label={opt.label}
            />
            {selected === opt.value && group.extra ? group.extra(opt.value) : null}
          </div>
        ))}
      </AccessGroup>
    );
  }

  return (
    <div className="access-col flex min-h-[420px] flex-col">
      <div className="access-col-title">{title}</div>
      <div className="flex flex-1 flex-col">
        {bodyGroups.map(renderGroup)}
        <div className="mt-auto pt-2">
          {resultGroup ? renderGroup(resultGroup) : null}
          <div className="pt-1">
            <AccessBtn onClick={onDisplay}>{t("menus.displayResults")}</AccessBtn>
          </div>
        </div>
      </div>
    </div>
  );
}

function cellText(col: AccessTableColumn, row: Record<string, unknown>): string {
  const raw = row[col.key];
  if (col.format) return col.format(raw, row);
  if (raw == null || raw === "") return "";
  if (col.key.toLowerCase().includes("date") || col.key === "label") {
    return formatDisplayedDate(raw);
  }
  return String(raw);
}

export function AccessDataTable({
  columns,
  rows,
  caption,
}: {
  columns: AccessTableColumn[];
  rows: Record<string, unknown>[];
  caption?: string;
}) {
  return (
    <div className="overflow-x-auto">
      {caption ? <div className="mb-1 text-[11px] text-[#404040]">{caption}</div> : null}
      <table className="access-cont-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={
                    c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center tabular-nums" : undefined
                  }
                >
                  {cellText(c, row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultsPane({
  mode,
  title,
  rows,
  xKey,
  yKey,
  yLabel,
  columns,
  basisNote,
}: {
  mode: "chart" | "table";
  title: string;
  rows: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  yLabel: string;
  /** Access multi-column table; when set, table mode uses these instead of 2-col. */
  columns?: AccessTableColumn[];
  basisNote?: string;
}) {
  const { t } = useI18n();
  useCalendar();
  if (rows.length === 0) {
    return <div className="access-sunken mt-3 p-3 text-[12px]">{t("menus.noRecordsPeriod")}</div>;
  }
  return (
    <div className="access-sunken mt-3">
      <div className="mb-1 text-[12px] font-bold">{title}</div>
      {basisNote ? <div className="mb-2 text-[11px] text-[#404040]">{basisNote}</div> : null}
      {mode === "chart" ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
            <XAxis dataKey={xKey} stroke="#000" fontSize={11} tickFormatter={(value) => formatDisplayedDate(value)} />
            <YAxis stroke="#000" fontSize={11} />
            <Tooltip labelFormatter={(value) => formatDisplayedDate(value)} />
            <Bar dataKey={yKey} name={yLabel} fill="#0a246a" />
          </BarChart>
        </ResponsiveContainer>
      ) : columns?.length ? (
        <AccessDataTable columns={columns} rows={rows} />
      ) : (
        <table className="access-cont-table">
          <thead>
            <tr>
              <th>{xKey}</th>
              <th>{yLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>{formatDisplayedDate(row[xKey])}</td>
                <td>{row[yKey] == null ? "" : String(row[yKey])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function useColumnState(initial: Record<string, string>) {
  const [values, setValues] = useState(initial);
  return {
    values,
    onChange: (name: string, value: string) => setValues((prev) => ({ ...prev, [name]: value })),
  };
}
