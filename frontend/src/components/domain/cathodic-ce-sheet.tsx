"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AccessHub } from "@/components/layout/access-hub";
import { InspectionSignaturePad } from "@/components/domain/inspection-signature";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { LoadingState } from "@/components/ui/spinner";
import {
  calcCathodic,
  cathodicCeApi,
  formatCe,
  type CathodicRow,
  type CathodicSheet,
} from "@/lib/cathodic-ce";
import { todayIsoLocal } from "@/lib/date-range";
import { useI18n } from "@/lib/i18n/context";

type Cells = Record<string, Record<string, string>>;

function textOf(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function cellsFrom(sheet: CathodicSheet): Cells {
  const cells: Cells = {};
  for (const [code, hours] of Object.entries(sheet.inputs.readings || {})) {
    cells[code] = {};
    for (const [hour, value] of Object.entries(hours)) cells[code][hour] = String(value);
  }
  return cells;
}

function hasNumber(values: Record<string, string> | undefined, hours: string[]): boolean {
  return hours.some((hour) => {
    const raw = values?.[hour];
    if (raw == null || String(raw).trim() === "") return false;
    return Number.isFinite(Number(String(raw).replace(",", ".")));
  });
}

export function CathodicCeSheet({ train }: { train: 1 | 2 }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [day, setDay] = useState(todayIsoLocal);
  const [dateLabel, setDateLabel] = useState("");
  const [totalLoad, setTotalLoad] = useState("");
  const [initial, setInitial] = useState("");
  const [finalReading, setFinalReading] = useState("");
  const [testHours, setTestHours] = useState("");
  const [cells, setCells] = useState<Cells>({});
  const [inspName, setInspName] = useState("");
  const [inspImage, setInspImage] = useState("");
  const [inspAt, setInspAt] = useState("");
  const [procName, setProcName] = useState("");
  const [procImage, setProcImage] = useState("");
  const [procAt, setProcAt] = useState("");
  const [notice, setNotice] = useState("");

  const sheetQuery = useQuery({
    queryKey: ["cathodic-ce", train, day],
    queryFn: () => cathodicCeApi.sheet(train, day),
    refetchOnWindowFocus: false,
  });
  const historyQuery = useQuery({
    queryKey: ["cathodic-ce-history", train],
    queryFn: () => cathodicCeApi.history(train),
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    const sheet = sheetQuery.data;
    if (!sheet || sheet.sheet_date !== day) return;
    setDateLabel(sheet.inputs.date_label || "");
    setTotalLoad(sheet.inputs.total_load || "");
    setInitial(textOf(sheet.inputs.initial_reading));
    setFinalReading(textOf(sheet.inputs.final_reading));
    setTestHours(textOf(sheet.inputs.test_hours));
    setCells(cellsFrom(sheet));
    setInspName(sheet.inputs.sign_insp_name || "");
    setInspImage(sheet.inputs.sign_insp_image || "");
    setInspAt(sheet.inputs.sign_insp_at || "");
    setProcName(sheet.inputs.sign_proc_name || "");
    setProcImage(sheet.inputs.sign_proc_image || "");
    setProcAt(sheet.inputs.sign_proc_at || "");
    setNotice("");
  }, [sheetQuery.data, day]);

  const sheet = sheetQuery.data;
  const hours = sheet?.yellow_hours?.length ? sheet.yellow_hours : sheet?.hours || [];
  const computed = useMemo(
    () => (sheet ? calcCathodic(sheet.rows, hours, cells, {}, initial, finalReading, testHours) : null),
    [sheet, hours, cells, initial, finalReading, testHours]
  );

  const save = useMutation({
    mutationFn: () => {
      const readings: Record<string, Record<string, number>> = {};
      for (const [code, hours] of Object.entries(cells)) {
        const cleaned: Record<string, number> = {};
        for (const [hour, raw] of Object.entries(hours)) {
          const n = Number(String(raw).replace(",", "."));
          if (raw !== "" && Number.isFinite(n)) cleaned[hour] = n;
        }
        if (Object.keys(cleaned).length) readings[code] = cleaned;
      }
      const flags: Record<string, number> = {};
      for (const row of sheetQuery.data?.rows || []) {
        if (row.kind === "load" && hasNumber(cells[row.code], sheetQuery.data?.yellow_hours || [])) flags[row.letter] = 1;
      }
      const num = (raw: string) => {
        if (raw.trim() === "") return null;
        const n = Number(raw.replace(",", "."));
        return Number.isFinite(n) ? n : null;
      };
      return cathodicCeApi.save({
        train,
        sheet_date: day,
        date_label: dateLabel,
        total_load: totalLoad,
        initial_reading: num(initial),
        final_reading: num(finalReading),
        test_hours: num(testHours),
        readings,
        online: flags,
        sign_insp_name: inspName,
        sign_insp_image: inspImage,
        sign_insp_at: inspAt,
        sign_proc_name: procName,
        sign_proc_image: procImage,
        sign_proc_at: procAt,
      });
    },
    onSuccess: async () => {
      setNotice(t("cathodicCe.saved"));
      await queryClient.invalidateQueries({ queryKey: ["cathodic-ce-history", train] });
    },
  });

  function clearChecks() {
    setInspName("");
    setInspImage("");
    setInspAt("");
    setProcName("");
    setProcImage("");
    setProcAt("");
  }

  function setCell(code: string, hour: string, value: string) {
    setCells((prev) => ({ ...prev, [code]: { ...(prev[code] || {}), [hour]: value } }));
    clearChecks();
  }

  const ce = computed?.q37 ?? null;
  const started = Boolean(
    initial ||
      finalReading ||
      testHours ||
      Object.values(cells).some((row) => Object.values(row).some((value) => String(value).trim() !== ""))
  );
  const missingLabels =
    sheet && computed && started
      ? computed.missing
          .filter((code) => sheet.rows.find((row) => row.code === code)?.kind !== "conc")
          .map((code) => sheet.rows.find((row) => row.code === code)?.label)
          .filter((label): label is string => Boolean(label))
      : [];

  return (
    <AccessHub title={`${t("cathodicCe.title")} ${train}`} backHref="/current-efficiency">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="text-[12px] font-bold">
          {t("cathodicCe.day")}
          <DateInput type="date" value={day} onChange={(e) => setDay(e.target.value)} />
        </label>
        <label className="text-[12px] font-bold">
          {t("cathodicCe.dateLabel")}
          <input className="access-inset-field mt-1 block w-64" value={dateLabel} onChange={(e) => { setDateLabel(e.target.value); clearChecks(); }} />
        </label>
        <label className="text-[12px] font-bold">
          {t("cathodicCe.totalLoad")}
          <input className="access-inset-field mt-1 block w-28" value={totalLoad} onChange={(e) => { setTotalLoad(e.target.value); clearChecks(); }} placeholder="125KA" />
        </label>
        <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !day}>
          {t("cathodicCe.save")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => cathodicCeApi.downloadSheet(train, day)} disabled={!day}>
          {t("cathodicCe.exportSheet")}
        </Button>
        <Button type="button" variant="secondary" onClick={() => cathodicCeApi.downloadHistory(train)}>
          {t("cathodicCe.exportHistory")}
        </Button>
        {notice ? <span className="text-[12px] font-bold text-green-700">{notice}</span> : null}
        {save.isError ? <span className="text-[12px] text-red-700">{(save.error as Error).message}</span> : null}
      </div>

      <p className="mb-2 max-w-5xl text-[12px] leading-5">{t("cathodicCe.hint")}</p>

      {sheet ? (
        <CheckStep
          started={started}
          inspName={inspName}
          inspImage={inspImage}
          inspAt={inspAt}
          procName={procName}
          procImage={procImage}
          procAt={procAt}
          onInsp={(patch) => {
            if (patch.name !== undefined) setInspName(patch.name);
            if (patch.image !== undefined) setInspImage(patch.image);
            if (patch.at !== undefined) setInspAt(patch.at);
          }}
          onProc={(patch) => {
            if (patch.name !== undefined) setProcName(patch.name);
            if (patch.image !== undefined) setProcImage(patch.image);
            if (patch.at !== undefined) setProcAt(patch.at);
          }}
          t={t}
        />
      ) : null}

      {sheetQuery.isLoading ? <LoadingState /> : null}
      {sheetQuery.isError ? <p className="text-[12px] text-red-700">{(sheetQuery.error as Error).message}</p> : null}

      {sheet && computed ? (
        <>
          <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold">{sheet.title}</div>
              <div className="text-[11px] text-neutral-600">{sheet.production_tag}</div>
            </div>
            <div className="access-sunken px-4 py-2 text-center">
              <div className="text-[11px] font-bold">{t("cathodicCe.ce")}</div>
              <div className="text-[28px] font-bold leading-none">{ce === null ? "—" : formatCe(ce)}</div>
              <div className="text-[11px]">%</div>
            </div>
          </div>

          <div className="overflow-x-auto border border-neutral-400 bg-white">
            <table className="border-collapse text-[11px]">
              <thead>
                <tr className="bg-[#fff59d]">
                  <th className="sticky left-0 z-10 border border-neutral-300 bg-[#fff59d] px-1 py-1">{t("cathodicCe.item")}</th>
                  <th className="border border-neutral-300 px-2 py-1 text-left">{t("cathodicCe.description")}</th>
                  <th className="border border-neutral-300 px-1 py-1">{t("cathodicCe.average")}</th>
                  {hours.map((hour) => (
                    <th key={hour} className="border border-neutral-300 bg-[#ffff00] px-1 py-1">
                      {hour}
                    </th>
                  ))}
                  <th className="border border-neutral-300 px-1 py-1">on/off</th>
                </tr>
              </thead>
              <tbody>
                <HeaderInputs
                  initial={initial}
                  finalReading={finalReading}
                  onInitial={(value) => { setInitial(value); clearChecks(); }}
                  onFinal={(value) => { setFinalReading(value); clearChecks(); }}
                  span={hours.length}
                  production={sheet.production_tag}
                />
                {sheet.rows.map((row) => (
                  <DataRow
                    key={row.code}
                    row={row}
                    hours={hours}
                    values={cells[row.code] || {}}
                    average={computed.averages[row.code] ?? null}
                    online={row.kind === "load" && hasNumber(cells[row.code], hours)}
                    onCell={(hour, value) => setCell(row.code, hour, value)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 grid gap-3 lg:grid-cols-[280px_1fr]">
            <label className="text-[12px] font-bold">
              {t("cathodicCe.testHours")}
              <input
                className="access-inset-field mt-1 block w-full bg-[#ffff00]"
                value={testHours}
                onChange={(e) => { setTestHours(e.target.value); clearChecks(); }}
                inputMode="decimal"
              />
            </label>
            <ResultGrid computed={computed} t={t} />
          </div>

          {started && (missingLabels.length || computed.on_count === 0) ? (
            <p className="mt-2 max-w-5xl text-[12px] leading-5 text-amber-800">
              {computed.on_count === 0 ? t("cathodicCe.needOnline") : null}{" "}
              {missingLabels.length ? t("cathodicCe.needRows", { rows: missingLabels.join(", ") }) : null}
            </p>
          ) : null}

          <Displays displays={sheet.displays} title={t("cathodicCe.displays")} />
        </>
      ) : null}

      <History train={train} rows={historyQuery.data?.rows || []} t={t} />
    </AccessHub>
  );
}

function CheckStep({
  started,
  inspName,
  inspImage,
  inspAt,
  procName,
  procImage,
  procAt,
  onInsp,
  onProc,
  t,
}: {
  started: boolean;
  inspName: string;
  inspImage: string;
  inspAt: string;
  procName: string;
  procImage: string;
  procAt: string;
  onInsp: (patch: { name?: string; image?: string; at?: string }) => void;
  onProc: (patch: { name?: string; image?: string; at?: string }) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const checked = Boolean(inspName.trim() && procName.trim());
  return (
    <section className="mb-3">
      <ol className="wf-stepper">
        <li className={`wf-step${started ? " is-done" : " is-current"}`}>
          <span className="wf-step-dot">1</span>
          <span className="wf-step-label">{t("cathodicCe.stepEntry")}</span>
        </li>
        <li className={`wf-step${checked ? " is-done" : started ? " is-current" : ""}`}>
          <span className="wf-step-dot">2</span>
          <span className="wf-step-label">{t("wf.status.await_inspection")}</span>
          <span className="wf-step-group">{t("wf.stageGroup.inspection.await_inspection")}</span>
        </li>
      </ol>
      <div className="mt-2 border border-neutral-400 bg-white p-2">
        <div className="mb-2 text-[12px] font-bold">{t("wf.status.await_inspection")}</div>
        <p className="mb-2 max-w-5xl text-[12px] leading-5 text-neutral-700">
          {checked ? t("cathodicCe.checkDone") : t("cathodicCe.checkPending")}
        </p>
        <div className="grid gap-2 md:grid-cols-2">
          <InspectionSignaturePad
            label={t("cathodicCe.signInspection")}
            name={inspName}
            image={inspImage}
            readOnly={false}
            onChange={onInsp}
          />
          <InspectionSignaturePad
            label={t("cathodicCe.signProcess")}
            name={procName}
            image={procImage}
            readOnly={false}
            onChange={onProc}
          />
        </div>
        {inspAt || procAt ? (
          <p className="mt-1 text-[11px] text-neutral-600">
            {inspAt ? `${t("cathodicCe.signInspection")}: ${inspAt}` : ""}
            {inspAt && procAt ? " · " : ""}
            {procAt ? `${t("cathodicCe.signProcess")}: ${procAt}` : ""}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function HeaderInputs({
  initial,
  finalReading,
  onInitial,
  onFinal,
  span,
  production,
}: {
  initial: string;
  finalReading: string;
  onInitial: (v: string) => void;
  onFinal: (v: string) => void;
  span: number;
  production: string;
}) {
  const field = "w-24 border border-neutral-300 bg-[#ffff00] px-1 py-0.5 text-center";
  return (
    <>
      <tr>
        <td className="sticky left-0 border border-neutral-300 bg-white px-1 font-bold">I.R</td>
        <td className="border border-neutral-300 px-2">100% w/w NaOH Production at initial reading (Mton), {production}</td>
        <td className="border border-neutral-300 p-0.5">
          <input className={field} value={initial} onChange={(e) => onInitial(e.target.value)} inputMode="decimal" />
        </td>
        <td className="border border-neutral-300 bg-[#fff59d] text-center font-bold" colSpan={span}>
          TIME
        </td>
        <td className="border border-neutral-300" />
      </tr>
      <tr>
        <td className="sticky left-0 border border-neutral-300 bg-white px-1 font-bold">F.R</td>
        <td className="border border-neutral-300 px-2">100% w/w NaOH Production at Final reading (Mton), {production}</td>
        <td className="border border-neutral-300 p-0.5">
          <input className={field} value={finalReading} onChange={(e) => onFinal(e.target.value)} inputMode="decimal" />
        </td>
        <td className="border border-neutral-300" colSpan={span + 1} />
      </tr>
    </>
  );
}

function DataRow({
  row,
  hours,
  values,
  average,
  online,
  onCell,
}: {
  row: CathodicRow;
  hours: string[];
  values: Record<string, string>;
  average: number | null;
  online: boolean;
  onCell: (hour: string, value: string) => void;
}) {
  return (
    <tr>
      <td className="sticky left-0 border border-neutral-300 bg-white px-1 font-bold">{row.label}</td>
      <td className="whitespace-nowrap border border-neutral-300 px-2">
        {row.description}
        {row.kind === "voltage" ? <span className="text-neutral-500">, {row.tag}</span> : null}
      </td>
      <td className="border border-neutral-300 bg-[#e3f2fd] px-1 text-center font-bold">{formatCe(average)}</td>
      {hours.map((hour) => (
        <td key={hour} className="border border-neutral-300 bg-[#ffff00] p-0">
          <input
            className="w-16 bg-transparent px-0.5 py-0.5 text-center"
            value={values[hour] || ""}
            onChange={(e) => onCell(hour, e.target.value)}
            inputMode="decimal"
            aria-label={`${row.label} ${hour}`}
          />
        </td>
      ))}
      <td className="border border-neutral-300 text-center">
        {row.kind === "load" ? (
          <input
            type="checkbox"
            checked={online}
            onChange={() => undefined}
            className="pointer-events-none"
            aria-label={`${row.label} on/off`}
          />
        ) : null}
      </td>
    </tr>
  );
}

function ResultGrid({ computed, t }: { computed: NonNullable<ReturnType<typeof calcCathodic>>; t: (k: string) => string }) {
  const items: { label: string; value: number | null; unit: string }[] = [
    { label: t("cathodicCe.j30"), value: computed.j30, unit: "KA/m²" },
    { label: t("cathodicCe.j33"), value: computed.j33, unit: "V" },
    { label: t("cathodicCe.j34"), value: computed.j34, unit: "V" },
    { label: t("cathodicCe.j35"), value: computed.j35, unit: "KA" },
    { label: t("cathodicCe.j37"), value: computed.j37, unit: "t/day" },
    { label: "Etheoretical", value: computed.q32, unit: "kwh/t" },
    { label: "Emeasured", value: computed.q33, unit: "kwh/t" },
    { label: "Emeasured,corr.", value: computed.q34, unit: "kwh/t" },
    { label: t("cathodicCe.power"), value: computed.q35, unit: "%" },
    { label: t("cathodicCe.ce"), value: computed.q37, unit: "%" },
    { label: t("cathodicCe.extrapolated"), value: computed.q39, unit: "mtpd" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="border border-neutral-300 bg-[#e3f2fd] px-2 py-1">
          <div className="text-[10px] leading-tight">{item.label}</div>
          <div className="text-[14px] font-bold">
            {formatCe(item.value) || "—"} <span className="text-[10px] font-normal">{item.unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function Displays({ displays, title }: { displays: { tag: string; how_often: string; what: string }[]; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" className="text-[12px] font-bold underline" onClick={() => setOpen((v) => !v)}>
        {title}
      </button>
      {open ? (
        <table className="mt-1 border-collapse text-[11px]">
          <tbody>
            {displays.map((row) => (
              <tr key={`${row.what}-${row.tag}`}>
                <td className="border border-neutral-300 px-2 py-0.5 font-bold">{row.tag}</td>
                <td className="border border-neutral-300 px-2 py-0.5">{row.what}</td>
                <td className="border border-neutral-300 px-2 py-0.5">{row.how_often}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function History({
  train,
  rows,
  t,
}: {
  train: number;
  rows: { sheet_date: string; ce: number | null; production: number | null }[];
  t: (path: string, vars?: Record<string, string | number | null | undefined>) => string;
}) {
  const chartRows = rows.filter((row) => row.ce !== null);
  return (
    <div className="mt-4">
      <div className="mb-1 text-[13px] font-bold">{t("cathodicCe.history", { train })}</div>
      {chartRows.length ? (
        <div className="h-56 w-full max-w-4xl">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="sheet_date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} unit="%" />
              <Tooltip />
              <Line type="monotone" dataKey="ce" name="CE %" stroke="#1565c0" strokeWidth={2} dot />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : rows.length ? null : (
        <p className="text-[12px]">{t("cathodicCe.noHistory")}</p>
      )}
      {rows.length ? (
        <div className="mt-2 overflow-x-auto">
          <table className="border-collapse text-[11px]">
            <thead>
              <tr className="bg-[#fff59d]">
                <th className="border border-neutral-300 px-2 py-1">{t("cathodicCe.day")}</th>
                <th className="border border-neutral-300 px-2 py-1">{t("cathodicCe.ce")}</th>
                <th className="border border-neutral-300 px-2 py-1">{t("cathodicCe.j37")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.sheet_date}>
                  <td className="border border-neutral-300 px-2 py-0.5">{row.sheet_date}</td>
                  <td className="border border-neutral-300 px-2 py-0.5 text-center">{formatCe(row.ce) || "—"}</td>
                  <td className="border border-neutral-300 px-2 py-0.5 text-center">{formatCe(row.production) || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
