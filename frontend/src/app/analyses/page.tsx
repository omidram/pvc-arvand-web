"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { analysesApi, type ImportProgress } from "@/lib/endpoints";
import { ImportProgressBar } from "@/components/domain/import-progress";
import { AnalysisEntry } from "@/components/domain/analysis-entry";
import { AccessBtn } from "@/components/layout/access-hub";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";

// Fixed row position of each analysis type, matching the real Access "Analyse"
// form exactly: every column places its buttons on the same rows, leaving a
// blank gap on rows it doesn't support (e.g. Group/Element have no Hydrogen,
// HCl, Demin. Water or Lean Caustic row) so all 5 columns end up the same height.
const ROW: Record<string, number> = {
  anolyte: 1,
  catholyte: 2,
  pure_brine: 3,
  chlorine_gas: 4,
  hydrogen: 5,
  hcl: 6,
  demin_water: 7,
  caustic_feed: 8,
};
const TOTAL_ROWS = 8;

type ColumnItem = { row: number; labelKey: string; type: string };
const COLUMNS: { titleKey: string; scope: string; items: ColumnItem[] }[] = [
  {
    titleKey: "menus.totalPlant",
    scope: "total_plant",
    items: [
      { row: ROW.anolyte, labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { row: ROW.catholyte, labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { row: ROW.pure_brine, labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { row: ROW.chlorine_gas, labelKey: "menus.chlorine", type: "chlorine_gas" },
      { row: ROW.hydrogen, labelKey: "enums.analysisType.hydrogen", type: "hydrogen" },
      { row: ROW.hcl, labelKey: "menus.hclToAnolyte", type: "hcl" },
      { row: ROW.demin_water, labelKey: "menus.deminWater", type: "demin_water" },
      { row: ROW.caustic_feed, labelKey: "menus.leanCaustic", type: "caustic_feed" },
    ],
  },
  {
    titleKey: "menus.train",
    scope: "sub_plant",
    items: [
      { row: ROW.anolyte, labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { row: ROW.catholyte, labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { row: ROW.pure_brine, labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { row: ROW.chlorine_gas, labelKey: "menus.chlorine", type: "chlorine_gas" },
      { row: ROW.hcl, labelKey: "menus.hclToAnolyte", type: "hcl" },
      { row: ROW.caustic_feed, labelKey: "menus.leanCausticFeed", type: "caustic_feed" },
    ],
  },
  {
    titleKey: "menus.electrolyzer",
    scope: "electrolyzer",
    items: [
      { row: ROW.anolyte, labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { row: ROW.catholyte, labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { row: ROW.pure_brine, labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { row: ROW.chlorine_gas, labelKey: "menus.chlorine", type: "chlorine_gas" },
      { row: ROW.hcl, labelKey: "menus.hclAcidification", type: "hcl" },
    ],
  },
  {
    titleKey: "menus.group",
    scope: "group",
    items: [
      { row: ROW.anolyte, labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { row: ROW.catholyte, labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { row: ROW.pure_brine, labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { row: ROW.chlorine_gas, labelKey: "menus.chlorine", type: "chlorine_gas" },
    ],
  },
  {
    titleKey: "menus.element",
    scope: "element",
    items: [
      { row: ROW.anolyte, labelKey: "enums.analysisType.anolyte", type: "anolyte" },
      { row: ROW.catholyte, labelKey: "enums.analysisType.catholyte", type: "catholyte" },
      { row: ROW.pure_brine, labelKey: "enums.analysisType.pure_brine", type: "pure_brine" },
      { row: ROW.chlorine_gas, labelKey: "menus.chlorine", type: "chlorine_gas" },
    ],
  },
];

function AnalysisMenu() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [importOpen, setImportOpen] = useState(false);
  return (
    <div className="access-hub" dir="ltr">
      {/*
        Custom header instead of the generic AccessHub, because the real Access
        "Analyse" form places "Main Menu" BETWEEN "Current Efficiency" and
        "Import Analyses" — not last.
      */}
      <div className="access-hub-head">
        <div className="access-hub-title">{t("analyses.title")}</div>
        <div className="flex flex-wrap items-start gap-2">
          <AccessBtn className="!w-auto px-3" href="/current-efficiency">
            {t("mainMenu.currentEfficiency")}
          </AccessBtn>
          <Link href="/" className="access-menu-btn access-hub-menu-btn">
            {t("common.mainMenu")}
          </Link>
          {isAdmin ? (
            <AccessBtn className="!w-auto px-3" onClick={() => setImportOpen(true)}>
              {t("menus.importAnalyses")}
            </AccessBtn>
          ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((col) => (
          <div key={col.titleKey} className="access-sunken">
            <div className="access-col-title mb-3">{t(col.titleKey)}</div>
            <div className="grid gap-2" style={{ gridTemplateRows: `repeat(${TOTAL_ROWS}, 28px)` }}>
              {col.items.map((item) => (
                <div key={item.row} style={{ gridRow: item.row }}>
                  <AccessBtn href={`/analyses?type=${item.type}&scope=${col.scope}`}>{t(item.labelKey)}</AccessBtn>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {importOpen ? <ImportAnalysesDialog onClose={() => setImportOpen(false)} /> : null}
    </div>
  );
}

function ImportAnalysesDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const mutation = useMutation({
    mutationFn: () => {
      setProgress({ percent: 0, processed: 0, total: 0 });
      return analysesApi.importLabExcel(file!, setProgress);
    },
    onSuccess: (data) => {
      setResult(t("analyses.importedSamples", { n: data.imported_samples }));
      queryClient.invalidateQueries({ queryKey: ["analyses"] });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="access-import-dialog">
        <div className="mb-3 flex items-center justify-between border-b border-[#808080] pb-1 text-[12px] font-bold">
          {t("analyses.importLabTitle")}
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="mb-3 text-[11px] text-[var(--win-muted)]">{t("analyses.importLabHelp")}</p>
        <label className="mb-3 block text-[12px]">
          {t("analyses.labExcelFile")}
          <input
            type="file"
            accept=".xlsx,.xls"
            className="mt-1 block w-full text-[12px]"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </label>
        {progress && mutation.isPending ? (
          <div className="mb-3">
            <ImportProgressBar progress={progress} wide />
          </div>
        ) : null}
        {result ? (
          <div className="mb-3 border border-[#5fa85f] bg-[#d9f0d9] px-2 py-1 text-[12px] font-semibold text-[#0d5c0d]">
            {result}
          </div>
        ) : null}
        {mutation.isError ? (
          <div className="mb-3 text-[12px] text-red-700">{(mutation.error as Error).message}</div>
        ) : null}
        <div className="flex justify-between">
          <AccessBtn
            className="!w-auto px-4"
            onClick={() => mutation.mutate()}
            disabled={!file || mutation.isPending}
          >
            {mutation.isPending ? t("common.importing") : t("common.import")}
          </AccessBtn>
          <AccessBtn className="!w-auto px-4" onClick={onClose}>
            {t("common.close")}
          </AccessBtn>
        </div>
      </div>
    </div>
  );
}

function AnalysesInner() {
  const searchParams = useSearchParams();
  const type = searchParams.get("type") || "";
  const scope = searchParams.get("scope") || "";
  if (type || scope) return <AnalysisEntry key={`${type}:${scope}`} analysisType={type} scope={scope} />;
  return <AnalysisMenu />;
}

export default function AnalysesPage() {
  return (
    <Suspense>
      <AnalysesInner />
    </Suspense>
  );
}
