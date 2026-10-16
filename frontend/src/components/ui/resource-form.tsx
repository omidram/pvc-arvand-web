"use client";

import { useState } from "react";
import { Button } from "./button";
import { AccessFields, accessPayload, valuesFromRecord } from "./access-fields";
import { useI18n } from "@/lib/i18n/context";

export interface FieldDef {
  name: string;
  label: string;
  type?: "text" | "number" | "date" | "datetime-local" | "checkbox" | "textarea" | "select" | "combo";
  options?: { label: string; value: string }[];
  required?: boolean;
  placeholder?: string;
  step?: string;
  span?: 1 | 2;
  /** When true this field cannot be edited (still submitted). */
  fieldReadOnly?: boolean;
}

export function ResourceForm<TValues extends object>({
  fields,
  initialValues,
  onSubmit,
  onCancel,
  submitLabel,
  submitting,
  readOnly,
  onValuesChange,
}: {
  fields: FieldDef[];
  initialValues?: Partial<TValues>;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
  onCancel: () => void;
  submitLabel?: string;
  submitting?: boolean;
  readOnly?: boolean;
  /** Return a patch (or full next values) after a field change — e.g. Access t An from t Ka. */
  onValuesChange?: (name: string, value: unknown, values: Record<string, unknown>) => Record<string, unknown> | void;
}) {
  const { t } = useI18n();
  const [values, setValues] = useState<Record<string, unknown>>(() => valuesFromRecord(fields, initialValues ?? null));
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await onSubmit(accessPayload(fields, values));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <AccessFields
        fields={fields}
        values={values}
        onChange={(name, value) =>
          setValues((v) => {
            const next = { ...v, [name]: value };
            const patch = onValuesChange?.(name, value, next);
            return patch ? { ...next, ...patch } : next;
          })
        }
        readOnly={readOnly}
      />
      {error ? (
        <p className="border-2 border-[#b54a4a] bg-[#fde8e8] px-2 py-1 text-[11px] font-semibold text-[#8a1f1f]">{error}</p>
      ) : null}
      <div className="flex justify-end gap-2 border-t-2 border-[var(--win-face-dark)] pt-3">
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
