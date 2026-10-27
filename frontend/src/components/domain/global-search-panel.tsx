"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon } from "lucide-react";
import { searchApi } from "@/lib/endpoints";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";

/** One box that searches every table of the program (Settings of access are respected by the server). */
export function GlobalSearchPanel() {
  const { locale } = useI18n();
  const fa = (f: string, e: string) => (locale === "fa" ? f : e);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState("");
  const result = useQuery({
    queryKey: ["global-search", submitted],
    queryFn: () => searchApi.global(submitted),
    enabled: submitted.length >= 2,
  });
  const go = () => {
    const q = text.trim();
    if (q.length >= 2) setSubmitted(q);
  };
  return (
    <section className="global-search">
      <div className="global-search-bar">
        <SearchIcon size={18} />
        <input
          className="access-inset-field"
          value={text}
          placeholder={fa("جستجوی سراسری: شماره المنت، آند، کاتد، ممبران، توقف، سفارش کار، شرکت، توضیحات ...", "Global search: element, anode, cathode, membrane, shutdown, work order, company, notes ...")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") go();
          }}
        />
        <button type="button" className="global-search-btn" onClick={go} disabled={text.trim().length < 2}>
          {fa("جستجوی سراسری", "Global search")}
        </button>
      </div>
      {result.isLoading ? <LoadingState /> : null}
      {result.isError ? <ErrorState message={(result.error as Error).message} /> : null}
      {result.data ? (
        <div className="global-search-results">
          <div className="global-search-total">
            {result.data.total
              ? fa(`${result.data.total} مورد برای «${result.data.q}» پیدا شد`, `${result.data.total} matches for “${result.data.q}”`)
              : fa(`چیزی برای «${result.data.q}» پیدا نشد`, `Nothing found for “${result.data.q}”`)}
          </div>
          {result.data.groups.map((g) => (
            <div key={g.key} className="global-search-group">
              <h4>
                {locale === "fa" ? g.fa : g.en} <span>({g.total})</span>
              </h4>
              <ul>
                {g.rows.map((row, i) => (
                  <li key={`${g.key}-${row.id}-${i}`}>
                    <Link href={row.href}>
                      <strong>{row.title}</strong>
                    </Link>
                    {Object.keys(row.info).length ? (
                      <span className="global-search-info">{Object.values(row.info).join(" · ")}</span>
                    ) : null}
                    <span className="global-search-hits">
                      {row.matches.map((m) => (
                        <em key={m.field}>
                          {m.field}: {m.value}
                        </em>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
              {g.total > g.rows.length ? (
                <div className="global-search-more">{fa(`${g.total - g.rows.length} مورد دیگر — عبارت را دقیق‌تر کنید`, `${g.total - g.rows.length} more — refine the text`)}</div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
