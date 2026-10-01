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
  const [values, setValues] = useState<Record<string, unknown>>(() => valuesFromRecord(fields, initialValues ?? null));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit(accessPayload(fields, values));
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <AccessFields
        fields={fields}
        values={values}
        onChange={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
        readOnly={readOnly}
      />
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
