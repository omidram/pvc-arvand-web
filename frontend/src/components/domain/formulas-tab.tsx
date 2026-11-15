"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formulasApi, type FormulaParam, type FormulaRow } from "@/lib/formulas";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/ui/spinner";

function formulaError(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (typeof detail === "string" && detail) return detail;
  return err instanceof Error ? err.message : "Error";
}

function shown(expression: string, params: FormulaParam[]) {
  return expression.replace(/\{(\w+)\}/g, (_, name) => {
    const param = params.find((item) => item.name === name);
    return param ? String(param.value) : name;
  });
}

function FormulaCard({ row }: { row: FormulaRow }) {
  const { locale } = useI18n();
  const { canEdit } = useAuth();
  const fa = locale === "fa";
  const editable = canEdit("settings");
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(row.params.map((param) => [param.name, String(param.value)]))
  );
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft(Object.fromEntries(row.params.map((param) => [param.name, String(param.value)])));
  }, [row]);

  const save = useMutation({
    mutationFn: () => {
      const params: Record<string, number> = {};
      for (const param of row.params) {
        const number = Number(draft[param.name]);
        if (!Number.isFinite(number)) throw new Error(param.name);
        params[param.name] = number;
      }
      return formulasApi.update(row.key, params);
    },
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (err: unknown) => setError(formulaError(err)),
  });
  const reset = useMutation({
    mutationFn: () => formulasApi.reset(row.key),
    onSuccess: () => {
      setError("");
      void qc.invalidateQueries({ queryKey: ["formulas"] });
    },
    onError: (err: unknown) => setError(formulaError(err)),
  });
  const dirty = row.params.some((param) => Number(draft[param.name]) !== param.value);

  return (
    <article className="border border-[var(--win-border-shadow)] bg-[var(--win-input)] p-3">
      <h3 className="text-sm font-bold">{fa ? row.title_fa : row.title_en}</h3>
      <p className="mt-1 text-[11px] text-[var(--win-muted)]">
        <b>{fa ? "کجا" : "Where"}: </b>
        {fa ? row.where_fa : row.where_en}
      </p>
      <p className="text-[11px] text-[var(--win-muted)]">
        <b>{fa ? "چه چیزی را حساب می‌کند" : "Calculates"}: </b>
        {fa ? row.calculates_fa : row.calculates_en}
      </p>
      <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded bg-[var(--win-panel)] p-2 text-[11px] leading-5">{shown(row.expression, row.params.map((param) => ({ ...param, value: Number(draft[param.name]) })))}</pre>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {row.params.map((param) => (
          <label key={param.name} className="text-[11px]">
            <span className="mb-0.5 block font-semibold">
              {fa ? param.label_fa : param.label_en}
              {param.unit ? ` (${param.unit})` : ""}
            </span>
            <input
              type="number"
              step="any"
              disabled={!editable}
              value={draft[param.name] ?? ""}
              onChange={(event) => setDraft((cur) => ({ ...cur, [param.name]: event.target.value }))}
              className="h-7 w-full border border-[var(--win-border-shadow)] bg-[var(--win-input)] px-1"
            />
          </label>
        ))}
      </div>
      {error ? <p className="mt-2 text-[11px] text-[var(--win-danger)]">{error}</p> : null}
      {editable ? (
        <div className="mt-2 flex gap-2">
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {fa ? "ذخیره" : "Save"}
          </Button>
          <Button size="sm" variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>
            {fa ? "بازگشت به پیش‌فرض" : "Reset to default"}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function FormulasTab() {
  const { locale } = useI18n();
  const fa = locale === "fa";
  const query = useQuery({ queryKey: ["formulas"], queryFn: formulasApi.list });
  if (query.isLoading) return <LoadingState />;
  if (query.isError || !query.data) return <ErrorState message={(query.error as Error | null)?.message || "Error"} />;
  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--win-muted)]">
        {fa
          ? "هر فرمول می‌گوید در کدام قسمت استفاده می‌شود و چه چیزی را حساب می‌کند. عددها را می‌توان عوض کرد؛ شکل فرمول همان است."
          : "Each formula says where it is used and what it calculates. The numbers can be changed; the shape of the formula stays."}
      </p>
      {query.data.map((row) => (
        <FormulaCard key={row.key} row={row} />
      ))}
    </div>
  );
}
