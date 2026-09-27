"use client";

import { useState } from "react";
import { Button } from "./button";
import { Input, Label, Select, Textarea } from "./input";
import { useI18n } from "@/lib/i18n/context";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "checkbox" | "textarea" | "select";
  options?: { label: string; value: string }[];
  required?: boolean;
  placeholder?: string;
  step?: string;
  span?: 1 | 2;
}

function toInputValue(type: FieldDef["type"], value: unknown): string | boolean {
  if (value === null || value === undefined) return type === "checkbox" ? false : "";
  if (type === "checkbox") return Boolean(value);
  if ((type === "date" || type === "datetime-local") && typeof value === "string") {
    return type === "date" ? value.slice(0, 10) : value.slice(0, 16);
  }
  return String(value);
}

export function ResourceForm<TValues extends object>({
  fields,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  submitting,
  readOnly,
}: {
  fields: FieldDef[];
  initialValues?: Partial<TValues>;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
  submitLabel?: string;
  submitting?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of fields) {
      initial[f.name] = toInputValue(f.type, initialValues?.[f.name as keyof TValues]);
    }
    return initial;
  });

  function setField(name: string, value: unknown) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = values[f.name];
      if (f.type === "number") {
        payload[f.name] = raw === "" ? null : Number(raw);
      } else if (f.type === "checkbox") {
        payload[f.name] = Boolean(raw);
      } else {
        payload[f.name] = raw === "" ? null : raw;
      }
    }
    onSubmit(payload);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        {fields.map((f) => (
          <div key={f.name} className={f.span === 2 ? "col-span-2" : "col-span-1"}>
            {f.type !== "checkbox" && (
              <Label>
                {f.label}
                {f.required && <span className="text-[var(--win-danger)]"> *</span>}
              </Label>
            )}
            {f.type === "textarea" ? (
              <Textarea
                rows={3}
                required={f.required}
                placeholder={f.placeholder}
                value={values[f.name] as string}
                onChange={(e) => setField(f.name, e.target.value)}
                disabled={readOnly}
              />
            ) : f.type === "select" ? (
              <Select
                required={f.required}
                value={values[f.name] as string}
                onChange={(e) => setField(f.name, e.target.value)}
                disabled={readOnly}
              >
                <option value="">—</option>
                {f.options?.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            ) : f.type === "checkbox" ? (
              <label className="mt-1 flex items-center gap-2 text-sm font-semibold text-[var(--win-text)]">
                <input
                  type="checkbox"
                  checked={values[f.name] as boolean}
                  onChange={(e) => setField(f.name, e.target.checked)}
                  className="h-4 w-4 accent-[var(--win-navy)]"
                  disabled={readOnly}
                />
                {f.label}
              </label>
            ) : (
              <Input
                type={f.type || "text"}
                step={f.step}
                required={f.required}
                placeholder={f.placeholder}
                value={values[f.name] as string}
                onChange={(e) => setField(f.name, e.target.value)}
                disabled={readOnly}
              />
            )}
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-4">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {readOnly ? t("common.close") : t("common.cancel")}
        </Button>
        {!readOnly && (
          <Button type="submit" disabled={submitting}>
            {submitting ? t("common.saving") : submitLabel ?? t("common.save")}
          </Button>
        )}
      </div>
    </form>
  );
}
