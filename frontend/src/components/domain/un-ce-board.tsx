"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessBtn } from "@/components/layout/access-hub";
import { AccessDataTable, type AccessTableColumn } from "@/components/layout/access-report";
import { LoadingState } from "@/components/ui/spinner";
import { formatDisplayedDate } from "@/lib/utils";
import { useI18n } from "@/lib/i18n/context";
import { useCalendar } from "@/lib/calendar/context";
import { unCeApi, type UnCeResult, type UnCeSettings, type UnCeSettingsInput } from "@/lib/un-ce";

const COLORS = [
  "#0a246a",
  "#c41212",
  "#0a7a2e",
  "#b36b00",
  "#6a1b9a",
  "#00838f",
  "#8d6e63",
  "#d81b60",
  "#455a64",
  "#7cb342",
  "#f4511e",
  "#3949ab",
];
const MAX_SERIES = 24;
const MAX_TABLE_ROWS = 1500;

export function useUnCeSettings() {
  return useQuery<UnCeSettings>({ queryKey: ["un-ce", "settings"], queryFn: () => unCeApi.settings() });
}

function errorText(error: unknown): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (error instanceof Error) return error.message;
  return "";
}

function NumberField({
  label,
  value,
  onChange,
  step,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
  min?: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[12px]">
      <span className="font-bold">{label}</span>
      <input
        type="number"
        className="access-inset-field w-20"
        value={value}
        step={step || "any"}
        min={min}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/**
 * The calculation settings of the Access `tblGewDaten` that drive Un and CE: reference current density,
 * element area, minimum voltage, anodic correction factor, ClO analysis, acidification and the
 * element temperature correction. They are stored on the server and shared by every Un / CE report.
 */
export function UnCeSettingsPanel() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const settings = useUnCeSettings();
  const [open, setOpen] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (payload: UnCeSettingsInput) => unCeApi.saveSettings(payload),
    onSuccess: () => {
      setEdits({});
      setSaved(true);
      void queryClient.invalidateQueries({ queryKey: ["un-ce"] });
      window.setTimeout(() => setSaved(false), 2500);
    },
  });

  const s = settings.data;
  const base: Record<string, string> = s
    ? {
        iref: String(s.iref),
        area_m2: String(s.area_m2),
        umin: String(s.umin),
        anodic_correction: String(s.anodic_correction),
        clo_analysis: String(s.clo_analysis),
        temp_correction_element: String(s.temp_correction_element),
        acidified: s.acidified ? "1" : "0",
      }
    : {};
  const draft: Record<string, string> = { ...base, ...edits };
  const set = (key: string) => (value: string) => setEdits((prev) => ({ ...prev, [key]: value }));
  const irefOptions = useMemo(() => {
    const values = new Set<number>((s?.iref_options || []).map((o) => o.iref));
    if (s) values.add(s.iref);
    return Array.from(values).sort((a, b) => a - b);
  }, [s]);

  function submit() {
    if (!s) return;
    save.mutate({
      iref: Number(draft.iref) || s.iref,
      area_m2: Number(draft.area_m2) || s.area_m2,
      umin: Number(draft.umin ?? s.umin),
      anodic_correction: Number(draft.anodic_correction || 0),
      clo_analysis: Number(draft.clo_analysis) === 1 ? 1 : 2,
      temp_correction_element: Number(draft.temp_correction_element) === 1 ? 1 : 2,
      acidified: draft.acidified === "1",
    });
  }

  return (
    <div className="access-sunken mb-3 px-3 py-2 text-[12px]">
      <button type="button" className="font-bold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? "▾" : "▸"} {t("unce.settings")}
        {s ? (
          <span className="ms-2 font-normal text-[#404040]">
            iRef {s.iref} kA/m² · tKorr {s.tkorr} · cKorr {s.ckorr} · {t("unce.area")} {s.area_m2} m² · Umin {s.umin}
          </span>
        ) : null}
      </button>
      {open && s ? (
        <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
          <label className="flex items-center gap-1">
            <span className="font-bold">iRef [kA/m²]</span>
            <select className="access-inset-field w-20" value={draft.iref ?? ""} onChange={(e) => set("iref")(e.target.value)}>
              {irefOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="font-bold">{t("unce.area")} [m²]</span>
            <input
              className="access-inset-field w-20"
              list="un-ce-area-options"
              value={draft.area_m2 ?? ""}
              onChange={(e) => set("area_m2")(e.target.value)}
            />
            <datalist id="un-ce-area-options">
              {s.area_options.map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </label>
          <NumberField label="Umin [V]" value={draft.umin ?? ""} onChange={set("umin")} step="0.01" min="0" />
          <NumberField label={t("unce.akf")} value={draft.anodic_correction ?? ""} onChange={set("anodic_correction")} step="0.01" />
          <label className="flex items-center gap-1">
            <span className="font-bold">{t("unce.cloAnalysis")}</span>
            <select
              className="access-inset-field"
              value={draft.clo_analysis ?? "2"}
              onChange={(e) => set("clo_analysis")(e.target.value)}
            >
              <option value="1">NaOCl</option>
              <option value="2">HOCl</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="font-bold">{t("unce.acidification")}</span>
            <select className="access-inset-field" value={draft.acidified ?? "1"} onChange={(e) => set("acidified")(e.target.value)}>
              <option value="1">{t("unce.yes")}</option>
              <option value="0">{t("unce.no")}</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="font-bold">{t("unce.tempCorrElement")}</span>
            <select
              className="access-inset-field"
              value={draft.temp_correction_element ?? "2"}
              onChange={(e) => set("temp_correction_element")(e.target.value)}
            >
              <option value="1">{t("unce.on")}</option>
              <option value="2">{t("unce.off")}</option>
            </select>
          </label>
          <AccessBtn className="!w-auto px-3" onClick={submit} disabled={save.isPending}>
            {t("unce.save")}
          </AccessBtn>
          {saved ? <span className="text-[#0a7a2e]">{t("unce.saved")}</span> : null}
          {save.isError ? <span className="text-[var(--win-danger)]">{errorText(save.error)}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function cellFormat(key: string): AccessTableColumn["format"] | undefined {
  const lower = key.toLowerCase();
  if (lower.includes("date") || lower === "label" || lower === "time") return undefined;
  return (value) => {
    if (value == null || value === "") return "";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
    return String(value);
  };
}

function buildChart(result: UnCeResult) {
  const seriesTotals = new Map<string, number>();
  for (const point of result.chart) seriesTotals.set(point.series, (seriesTotals.get(point.series) || 0) + 1);
  const series = Array.from(seriesTotals.keys()).slice(0, MAX_SERIES);
  const wanted = new Set(series);
  const byX = new Map<string, Record<string, { sum: number; n: number }>>();
  for (const point of result.chart) {
    if (!wanted.has(point.series)) continue;
    const bucket = byX.get(point.x) || {};
    const cell = bucket[point.series] || { sum: 0, n: 0 };
    cell.sum += point.value;
    cell.n += 1;
    bucket[point.series] = cell;
    byX.set(point.x, bucket);
  }
  const data = Array.from(byX.keys())
    .sort()
    .map((x) => {
      const row: Record<string, unknown> = { x };
      for (const [name, cell] of Object.entries(byX.get(x) || {})) row[name] = Number((cell.sum / cell.n).toFixed(4));
      return row;
    });
  return { data, series, clipped: seriesTotals.size > series.length };
}

/** Chart / table of an Un, CE or SPC engine result (one line per electrolyzer / group / element). */
export function UnCeResultsPane({
  title,
  mode,
  query,
}: {
  title: string;
  mode: "chart" | "table";
  query: UseQueryResult<UnCeResult>;
}) {
  const { t } = useI18n();
  useCalendar();
  const result = query.data;
  const chart = useMemo(() => (result ? buildChart(result) : null), [result]);
  const columns: AccessTableColumn[] = useMemo(
    () => (result?.columns || []).map((c) => ({ ...c, format: cellFormat(c.key) })),
    [result]
  );

  if (query.isLoading || (query.isFetching && !result)) {
    return (
      <div className="access-sunken mt-3 p-3">
        <LoadingState />
      </div>
    );
  }
  if (query.isError) {
    return <div className="access-sunken mt-3 p-3 text-[12px] text-[var(--win-danger)]">{errorText(query.error)}</div>;
  }
  if (!result || result.rows.length === 0) {
    return (
      <div className="access-sunken mt-3 p-3 text-[12px]">
        {t("menus.noRecordsPeriod")}
        {result?.note ? <div className="mt-1 text-[11px] text-[#404040]">{result.note}</div> : null}
      </div>
    );
  }

  const s = result.settings;
  const shownRows = result.rows.slice(0, MAX_TABLE_ROWS);
  return (
    <div className="access-sunken mt-3">
      <div className="mb-1 text-[12px] font-bold">{title}</div>
      <div className="mb-2 text-[11px] text-[#404040]">
        {result.note ? <div>{result.note}</div> : null}
        <div>
          iRef {s.iref} kA/m² · {t("unce.area")} {s.area_m2} m² · Umin {s.umin}
          {" · "}tKorr {s.tkorr} · cKorr {s.ckorr}
          {result.value_key === "mu_naoh" || result.value_key === "spc"
            ? ` · AKF ${s.anodic_correction} · ${s.clo_analysis === 1 ? "NaOCl" : "HOCl"} · ${t("unce.acidification")}: ${s.acidified ? t("unce.yes") : t("unce.no")}`
            : ""}
        </div>
        {result.truncated ? (
          <div className="text-[var(--win-danger)]">{t("unce.truncated", { shown: result.rows.length, total: result.total })}</div>
        ) : null}
      </div>
      {mode === "chart" && chart ? (
        <>
          {chart.clipped ? <div className="mb-1 text-[11px] text-[#404040]">{t("unce.seriesClipped", { max: MAX_SERIES })}</div> : null}
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chart.data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#808080" />
              <XAxis dataKey="x" stroke="#000" fontSize={11} tickFormatter={(value) => formatDisplayedDate(value)} />
              <YAxis stroke="#000" fontSize={11} domain={["auto", "auto"]} label={{ value: result.value_label, angle: -90, position: "insideLeft", style: { fontSize: 11 } }} />
              <Tooltip labelFormatter={(value) => formatDisplayedDate(value)} />
              {chart.series.length > 1 ? <Legend /> : null}
              {chart.series.map((name, idx) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={COLORS[idx % COLORS.length]}
                  dot={{ r: 2 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </>
      ) : (
        <>
          <AccessDataTable columns={columns} rows={shownRows} />
          {result.rows.length > shownRows.length ? (
            <div className="mt-1 text-[11px] text-[#404040]">{t("unce.truncated", { shown: shownRows.length, total: result.rows.length })}</div>
          ) : null}
        </>
      )}
    </div>
  );
}
