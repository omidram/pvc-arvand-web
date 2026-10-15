"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { formatDate } from "@/lib/utils";
import type { WfCoatingCandidate } from "@/lib/workflow";

type T = (k: string, vars?: Record<string, string | number | null | undefined>) => string;

const LIMIT = 40;

export function compactSerial(s: string): string {
  return s.toLowerCase().replace(/[^0-9a-z]/g, "");
}

/** Serials can only be taken from the TAFKIK list, so a typo cannot reach the request. */
export function CoatingSerialPicker({
  label,
  candidates,
  picked,
  onChange,
  loading,
  t,
}: {
  label: string;
  candidates: WfCoatingCandidate[];
  picked: WfCoatingCandidate[];
  onChange: (next: WfCoatingCandidate[]) => void;
  loading?: boolean;
  t: T;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [missing, setMissing] = useState<string[]>([]);
  const pickedKeys = useMemo(() => new Set(picked.map((c) => compactSerial(c.serial))), [picked]);
  const byKey = useMemo(() => new Map(candidates.map((c) => [compactSerial(c.serial), c])), [candidates]);

  const matches = useMemo(() => {
    const q = compactSerial(query);
    const starts: WfCoatingCandidate[] = [];
    const contains: WfCoatingCandidate[] = [];
    for (const c of candidates) {
      const key = compactSerial(c.serial);
      if (pickedKeys.has(key)) continue;
      if (!q || key.startsWith(q)) starts.push(c);
      else if (key.includes(q)) contains.push(c);
      if (starts.length >= LIMIT) break;
    }
    return starts.concat(contains).slice(0, LIMIT);
  }, [candidates, pickedKeys, query]);

  function add(c: WfCoatingCandidate) {
    if (c.busy || pickedKeys.has(compactSerial(c.serial))) return;
    onChange([...picked, c]);
    setQuery("");
    setActive(0);
    setMissing([]);
  }

  function addMany(text: string) {
    const next = [...picked];
    const seen = new Set(pickedKeys);
    const notFound: string[] = [];
    for (const raw of text.split(/[\r\n,;\t]+/)) {
      const s = raw.trim();
      if (!s) continue;
      const c = byKey.get(compactSerial(s));
      if (!c || c.busy) notFound.push(s);
      else if (!seen.has(compactSerial(c.serial))) {
        seen.add(compactSerial(c.serial));
        next.push(c);
      }
    }
    onChange(next);
    setMissing(notFound);
    setQuery("");
  }

  return (
    <div className="wf-picker">
      <span className="wf-picker-label">{label}</span>
      <div className="wf-picker-box">
        <input
          value={query}
          placeholder={loading ? t("common.loading") : t("wf.coating.pickPlaceholder")}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text");
            if (/[\r\n,;\t]/.test(text.trim())) {
              e.preventDefault();
              addMany(text);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setOpen(true);
              setActive((i) => Math.min(i + 1, matches.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const exact = byKey.get(compactSerial(query));
              const c = exact && !pickedKeys.has(compactSerial(exact.serial)) ? exact : matches[active];
              if (c) add(c);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {open && query.trim() ? (
          <ul className="wf-picker-list" role="listbox">
            {matches.length ? (
              matches.map((c, i) => (
                <li
                  key={c.serial}
                  role="option"
                  aria-selected={i === active}
                  aria-disabled={c.busy}
                  className={`${i === active ? "is-active" : ""}${c.busy ? " is-busy" : ""}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(c);
                  }}
                  onMouseEnter={() => setActive(i)}
                >
                  <strong>{c.serial}</strong>
                  <span className="wf-picker-meta">
                    {c.busy ? t("wf.coating.inOpenRequest") : [c.decision, c.problem, c.date ? formatDate(c.date) : null].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))
            ) : (
              <li className="is-empty">{t("wf.coating.notInTafkik")}</li>
            )}
          </ul>
        ) : null}
      </div>
      {missing.length ? (
        <div className="wf-alert">
          <strong>{t("wf.coating.pasteMissing")}</strong> {missing.join("، ")}
        </div>
      ) : null}
      {picked.length ? (
        <ul className="wf-chips">
          {picked.map((c) => (
            <li key={c.serial} title={[c.decision, c.problem].filter(Boolean).join(" · ")}>
              <span>{c.serial}</span>
              <button type="button" aria-label={t("common.delete")} onClick={() => onChange(picked.filter((p) => p.serial !== c.serial))}>
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
