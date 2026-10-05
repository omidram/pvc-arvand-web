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
  extra?: (value: string) => React.ReactNode;
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
  // Access keeps "Results as" + Display Results pinned to the bottom of each column.
  const bodyGroups = groups.filter((g) => g.name !== "result");
  const resultGroup = groups.find((g) => g.name === "result");

  function renderGroup(group: RadioGroupDef) {
    return (
      <AccessGroup key={group.name} legend={group.legend}>
        {group.options.map((opt) => (
          <AccessRadio
            key={opt.value}
            name={`${title}-${group.name}`}
            value={opt.value}
            checked={values[group.name] === opt.value}
            onChange={(v) => onChange(group.name, v)}
            label={opt.label}
          />
        ))}
        {group.extra ? group.extra(values[group.name]) : null}
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

export function ResultsPane({
  mode,
  title,
  rows,
  xKey,
  yKey,
  yLabel,
}: {
  mode: "chart" | "table";
  title: string;
  rows: Record<string, unknown>[];
  xKey: string;
  yKey: string;
  yLabel: string;
}) {
  const { t } = useI18n();
  useCalendar();
  if (rows.length === 0) {
    return <div className="access-sunken mt-3 p-3 text-[12px]">{t("menus.noRecordsPeriod")}</div>;
  }
  return (
    <div className="access-sunken mt-3">
      <div className="mb-2 text-[12px] font-bold">{title}</div>
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
