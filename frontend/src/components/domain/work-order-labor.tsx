"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import type { WoLaborLine, WoPerson, WoStage } from "@/lib/endpoints";

type Fa = (fa: string, en: string) => string;
type Data = Record<string, string | number | null | undefined>;

export function emptyJob(stage: WoStage): WoLaborLine {
  return { stage, kind: "job", skill: "", description: "", data: { persons: "", hours: "", title: "" } };
}

export function emptyActual(stage: WoStage): WoLaborLine {
  return {
    stage,
    kind: "actual",
    person_code: "",
    person_name: "",
    skill: "",
    work_hours: null,
    description: "",
    data: { date_from: "", date_to: "", time_from: "", time_to: "", minutes: "", title: "", action: "", device: "", shift: "" },
  };
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toMin = (t: unknown) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** "جمع نفرساعت" of the required-jobs tab: Σ persons × hours. */
export function jobTotals(rows: WoLaborLine[]) {
  let persons = 0;
  let hours = 0;
  let manHours = 0;
  for (const r of rows) {
    const d = (r.data || {}) as Data;
    persons += num(d.persons);
    hours += num(d.hours);
    manHours += num(d.persons) * num(d.hours);
  }
  return { persons, hours, manHours };
}

export function actualTotal(rows: WoLaborLine[]) {
  return rows.reduce((s, r) => s + (r.work_hours || 0), 0);
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

export function JobRows({
  stage,
  rows,
  skills,
  editable,
  onChange,
  fa,
}: {
  stage: WoStage;
  rows: WoLaborLine[];
  skills: string[];
  editable: boolean;
  onChange: (rows: WoLaborLine[]) => void;
  fa: Fa;
}) {
  const setRow = (idx: number, patch: Partial<WoLaborLine>, data?: Data) =>
    onChange(
      rows.map((r, i) =>
        i === idx ? { ...r, ...patch, stage, kind: "job", data: { ...(r.data || {}), ...(data || {}) } } : r
      )
    );
  const totals = jobTotals(rows);
  return (
    <div className="wo-lines">
      <div className="wo-lines-title">{fa("مشاغل / نفرساعت مورد نیاز", "Required jobs / man-hours")}</div>
      <table className="wo-lines-table">
        <thead>
          <tr>
            <th>{fa("شغل", "Job")}</th>
            <th>{fa("تعداد نفر", "Persons")}</th>
            <th>{fa("ساعت", "Hours")}</th>
            <th>{fa("عنوان فعالیت", "Activity title")}</th>
            <th>{fa("توضیحات", "Notes")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const d = (row.data || {}) as Data;
            return (
              <tr key={idx}>
                <td>
                  <select
                    className="ui-input"
                    value={row.skill || ""}
                    disabled={!editable}
                    onChange={(e) => setRow(idx, { skill: e.target.value })}
                  >
                    <option value="">—</option>
                    {skills.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <Input type="number" min="0" value={d.persons ?? ""} disabled={!editable} onChange={(e) => setRow(idx, {}, { persons: e.target.value })} />
                </td>
                <td>
                  <Input type="number" min="0" step="0.25" value={d.hours ?? ""} disabled={!editable} onChange={(e) => setRow(idx, {}, { hours: e.target.value })} />
                </td>
                <td>
                  <Input value={String(d.title ?? "")} disabled={!editable} onChange={(e) => setRow(idx, {}, { title: e.target.value })} />
                </td>
                <td>
                  <Input value={row.description || ""} disabled={!editable} onChange={(e) => setRow(idx, { description: e.target.value })} />
                </td>
                <td>
                  {editable ? (
                    <button
                      type="button"
                      className="wo-icon-btn"
                      onClick={() => onChange(rows.length <= 1 ? [emptyJob(stage)] : rows.filter((_, i) => i !== idx))}
                    >
                      <Trash2 size={14} />
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>{fa("جمع کل", "Total")}</td>
            <td>{fmt(totals.persons)}</td>
            <td>{fmt(totals.hours)}</td>
            <td colSpan={3}>
              {fa("جمع نفرساعت", "Total man-hours")}: <strong>{fmt(totals.manHours)}</strong>
            </td>
          </tr>
        </tfoot>
      </table>
      {editable ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, emptyJob(stage)])}>
          <Plus size={14} /> {fa("افزودن شغل", "Add job")}
        </Button>
      ) : null}
    </div>
  );
}

export function ActualRows({
  stage,
  rows,
  skills,
  people,
  editable,
  onChange,
  fa,
}: {
  stage: WoStage;
  rows: WoLaborLine[];
  skills: string[];
  people: WoPerson[];
  editable: boolean;
  onChange: (rows: WoLaborLine[]) => void;
  fa: Fa;
}) {
  const setRow = (idx: number, patch: Partial<WoLaborLine>, data?: Data) =>
    onChange(
      rows.map((r, i) => {
        if (i !== idx) return r;
        const nd: Data = { ...(r.data || {}), ...(data || {}) };
        let work_hours = patch.work_hours !== undefined ? patch.work_hours : r.work_hours;
        if (data && ("date_from" in data || "date_to" in data || "time_from" in data || "time_to" in data)) {
          const a = toMin(nd.time_from);
          const b = toMin(nd.time_to);
          if (a !== null && b !== null) {
            const days =
              nd.date_from && nd.date_to
                ? Math.max(0, Math.round((new Date(String(nd.date_to)).getTime() - new Date(String(nd.date_from)).getTime()) / 86400000))
                : 0;
            const mins = days * 1440 + b - a;
            if (mins >= 0) {
              nd.minutes = mins % 60;
              work_hours = Math.round((mins / 60) * 100) / 100;
            }
          }
        }
        return { ...r, ...patch, work_hours, stage, kind: "actual", data: nd };
      })
    );
  const total = actualTotal(rows);
  return (
    <div className="wo-lines">
      <div className="wo-lines-title">
        {fa("کارکرد نفرات", "Actual labour")} — {fa("جمع نفرساعت کارکرد", "total worked hours")}: <strong>{fmt(total)}</strong>
      </div>
      {rows.map((row, idx) => {
        const d = (row.data || {}) as Data;
        const roster = people.filter((p) => p.skill === (row.skill || ""));
        const locked = !editable || !row.skill;
        const hours = row.work_hours || 0;
        return (
          <div key={idx} className="wo-actual">
            <div className="wo-actual-person">
              <label>
                <span>{fa("شغل", "Job")}</span>
                <select
                  className="ui-input"
                  value={row.skill || ""}
                  disabled={!editable}
                  onChange={(e) => {
                    const skill = e.target.value;
                    const match = people.find((p) => p.skill === skill && p.person_code === (row.person_code || ""));
                    setRow(idx, { skill, person_name: match?.person_name || row.person_name });
                  }}
                >
                  <option value="">—</option>
                  {skills.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{fa("کد شخص", "Person code")}</span>
                <Input
                  value={row.person_code || ""}
                  disabled={locked}
                  list={`wo-ppl-${stage}-${idx}`}
                  onChange={(e) => {
                    const code = e.target.value;
                    const match = roster.find((p) => p.person_code === code);
                    setRow(idx, { person_code: code, person_name: match?.person_name || row.person_name });
                  }}
                />
                <datalist id={`wo-ppl-${stage}-${idx}`}>
                  {roster.map((p) => (
                    <option key={p.person_code} value={p.person_code}>
                      {p.person_name || p.person_code}
                    </option>
                  ))}
                </datalist>
              </label>
              <label>
                <span>{fa("نام", "Name")}</span>
                <Input value={row.person_name || ""} disabled={locked} onChange={(e) => setRow(idx, { person_name: e.target.value })} />
              </label>
              <label>
                <span>{fa("ساعت کار", "Work time")}</span>
                <select className="ui-input" value={String(d.shift ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { shift: e.target.value })}>
                  <option value="">{fa("** انتخاب کنید **", "** select **")}</option>
                  <option value="normal">{fa("عادی", "Normal")}</option>
                  <option value="overtime">{fa("اضافه‌کار", "Overtime")}</option>
                  <option value="holiday">{fa("تعطیل", "Holiday")}</option>
                </select>
              </label>
            </div>
            <div className="wo-actual-time">
              <div className="wo-actual-hint">
                {fa("تاریخ (جمع نفرساعت کارکرد", "Date (worked man-hours")}: {fmt(hours)})
              </div>
              <label>
                <span>{fa("از تاریخ", "From date")}</span>
                <DateInput type="date" value={String(d.date_from ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { date_from: e.target.value })} />
              </label>
              <label>
                <span>{fa("تا تاریخ", "To date")}</span>
                <DateInput type="date" value={String(d.date_to ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { date_to: e.target.value })} />
              </label>
              <label>
                <span>{fa("از ساعت", "From time")}</span>
                <Input type="time" value={String(d.time_from ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { time_from: e.target.value })} />
              </label>
              <label>
                <span>{fa("تا ساعت", "To time")}</span>
                <Input type="time" value={String(d.time_to ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { time_to: e.target.value })} />
              </label>
              <label>
                <span>{fa("ساعت", "Hours")}</span>
                <Input value={Math.floor(hours)} disabled readOnly />
              </label>
              <label>
                <span>{fa("دقیقه", "Minutes")}</span>
                <Input value={String(d.minutes ?? "")} disabled readOnly />
              </label>
            </div>
            <div className="wo-actual-act">
              <label>
                <span>{fa("عنوان فعالیت", "Activity title")}</span>
                <Input value={String(d.title ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { title: e.target.value })} />
              </label>
              <label>
                <span>{fa("اقدام صورت گرفته", "Action taken")}</span>
                <Input value={String(d.action ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { action: e.target.value })} />
              </label>
              <label>
                <span>{fa("دستگاه", "Device")}</span>
                <Input value={String(d.device ?? "")} disabled={locked} onChange={(e) => setRow(idx, {}, { device: e.target.value })} />
              </label>
            </div>
            <label className="wo-actual-sum">
              <span>{fa("خلاصه کار", "Work summary")}</span>
              <textarea className="ui-input" rows={4} value={row.description || ""} disabled={locked} onChange={(e) => setRow(idx, { description: e.target.value })} />
            </label>
            {editable ? (
              <button
                type="button"
                className="wo-icon-btn"
                onClick={() => onChange(rows.length <= 1 ? [emptyActual(stage)] : rows.filter((_, i) => i !== idx))}
              >
                <Trash2 size={14} />
              </button>
            ) : null}
          </div>
        );
      })}
      {editable ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, emptyActual(stage)])}>
          <Plus size={14} /> {fa("افزودن نفر", "Add person")}
        </Button>
      ) : null}
    </div>
  );
}
