"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn, AccessGroup, AccessRadio } from "@/components/layout/access-hub";

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
  return (
    <div className="access-col flex min-h-[420px] flex-col">
      <div className="access-col-title">{title}</div>
      <div className="flex flex-1 flex-col">
        {groups.map((group) => (
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
        ))}
        <div className="mt-auto pt-2">
          <AccessBtn onClick={onDisplay}>Display Results</AccessBtn>
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
  if (rows.length === 0) {
    return <div className="access-sunken mt-3 p-3 text-[12px]">No records in the selected time period.</div>;
  }
  return (
    <div className="access-sunken mt-3">
      <div className="mb-2 text-[12px] font-bold">{title}</div>
      {mode === "chart" ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
            <XAxis dataKey={xKey} stroke="#000" fontSize={11} />
            <YAxis stroke="#000" fontSize={11} />
            <Tooltip />
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
                <td>{String(row[xKey] ?? "")}</td>
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
