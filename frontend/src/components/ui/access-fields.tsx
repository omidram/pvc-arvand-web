"use client";

import { Input, Select, Textarea } from "@/components/ui/input";
import type { FieldDef } from "@/components/ui/resource-form";
import { cn } from "@/lib/utils";

export function toAccessValue(type: FieldDef["type"], value: unknown): string | boolean {
  if (value === null || value === undefined) return type === "checkbox" ? false : "";
  if (type === "checkbox") return Boolean(value);
  if ((type === "date" || type === "datetime-local") && typeof value === "string") {
    return type === "date" ? value.slice(0, 10) : value.slice(0, 16);
  }
  return String(value);
}

export function accessPayload(fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.name];
    if (f.type === "number") payload[f.name] = raw === "" ? null : Number(raw);
    else if (f.type === "checkbox") payload[f.name] = Boolean(raw);
    else payload[f.name] = raw === "" ? null : raw;
  }
  return payload;
}

export function valuesFromRecord(fields: FieldDef[], record?: object | null): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const f of fields) {
    initial[f.name] = toAccessValue(f.type, record ? (record as Record<string, unknown>)[f.name] : undefined);
  }
  return initial;
}

export function AccessFields({
  fields,
  values,
  onChange,
  readOnly,
  columns = 2,
}: {
  fields: FieldDef[];
  values: Record<string, unknown>;
  onChange: (name: string, value: unknown) => void;
  readOnly?: boolean;
  columns?: 1 | 2 | 3;
}) {
  return (
    <div
      className="grid gap-x-4 gap-y-1"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {fields.map((f) => (
        <div key={f.name} className={cn("flex items-start gap-2", f.span === 2 && columns > 1 ? "col-span-2" : "")}>
          {f.type === "checkbox" ? (
            <label className="flex items-center gap-2 py-0.5 text-[11px]">
              <input
                type="checkbox"
                checked={Boolean(values[f.name])}
                onChange={(e) => onChange(f.name, e.target.checked)}
                className="h-3.5 w-3.5 accent-[var(--win-navy)]"
                disabled={readOnly}
              />
              {f.label}
            </label>
          ) : (
            <>
              <span className="access-label">
                {f.label}
                {f.required ? <span className="text-[var(--win-danger)]"> *</span> : null}
              </span>
              <div className="min-w-0 flex-1">
                {f.type === "textarea" ? (
                  <Textarea
                    rows={2}
                    required={f.required}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => onChange(f.name, e.target.value)}
                    disabled={readOnly}
                    className="py-0.5 text-[11px]"
                  />
                ) : f.type === "select" ? (
                  <Select
                    required={f.required}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => onChange(f.name, e.target.value)}
                    disabled={readOnly}
                    className="h-[22px] py-0 text-[11px]"
                  >
                    <option value="">—</option>
                    {f.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    type={f.type || "text"}
                    step={f.step}
                    required={f.required}
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => onChange(f.name, e.target.value)}
                    disabled={readOnly}
                    className="h-[22px] py-0 text-[11px]"
                  />
                )}
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
