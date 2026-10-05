"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { arrangementBoardApi } from "@/lib/endpoints";
import { CellArrangementEditor } from "@/components/domain/cell-arrangement-editor";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { ElectrolyzerCombo } from "@/components/ui/electrolyzer-combo";
import { Badge } from "@/components/ui/badge";
import { ErrorState, Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";

export default function ArrangementBoardPage() {
  const { t } = useI18n();
  const { canView } = useAuth();
  const [electrolyzer, setElectrolyzer] = useState<string>("");
  const [selectedPos, setSelectedPos] = useState<number | null>(null);

  const boardQuery = useQuery({
    queryKey: ["arrangement-board", electrolyzer || null],
    queryFn: () => arrangementBoardApi.get(electrolyzer || undefined),
    enabled: canView("settings") || canView("elements"),
  });

  const data = boardQuery.data;
  const cells = data?.cells || [];
  const selected = useMemo(
    () => cells.find((c) => c.position === selectedPos) || null,
    [cells, selectedPos]
  );

  if (!canView("settings") && !canView("elements")) {
    return (
      <AccessFormWindow caption={t("arrangement.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  const currentEz = electrolyzer || data?.electrolyzer || "";

  return (
    <AccessFormWindow
      caption={t("arrangement.title")}
      helpKey="arrangement"
      commands={
        <Button type="button" variant="secondary" onClick={() => boardQuery.refetch()}>
          <RefreshCw size={14} /> {t("arrangement.updateDisplay")}
        </Button>
      }
    >
      <p className="mb-3 text-xs text-[var(--win-muted)]">{t("arrangement.description")}</p>

      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="min-w-[200px]">
          <Label>{t("fields.electrolyzer")}</Label>
          <ElectrolyzerCombo
            value={currentEz}
            extraOptions={data?.electrolyzers}
            placeholder={t("arrangement.selectElectrolyzer")}
            onChange={(v) => {
              setElectrolyzer(v);
              setSelectedPos(null);
            }}
          />
        </div>
        <Badge color="cyan">
          {t("arrangement.occupied")}: {data?.counts.occupied ?? "—"} / {data?.counts.positions ?? "—"}
        </Badge>
        <Badge color="slate">
          {t("arrangement.empty")}: {data?.counts.empty ?? "—"}
        </Badge>
        <Link href="/settings?tab=arrangements" className="text-xs font-semibold text-[var(--win-navy)] underline">
          {t("arrangement.editDefinitions")}
        </Link>
      </div>

      {boardQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : boardQuery.isError ? (
        <ErrorState message={(boardQuery.error as Error).message} />
      ) : !currentEz ? (
        <ErrorState message={t("arrangement.selectElectrolyzer")} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
          <div className="arrangement-board border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-panel)] p-2">
            <div
              className="grid gap-1"
              style={{ gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))" }}
            >
              {cells.map((cell) => (
                <button
                  key={cell.position}
                  type="button"
                  onClick={() => setSelectedPos(cell.position)}
                  className={`min-h-[54px] border px-1 py-0.5 text-center text-[10px] leading-tight ${
                    selectedPos === cell.position
                      ? "border-[var(--win-navy)] bg-[var(--win-navy)] text-white"
                      : cell.occupied
                        ? "border-[#6a9a6a] bg-[#dff0df] text-black"
                        : "border-[var(--win-border-shadow)] bg-[var(--win-face)] text-[var(--win-muted)]"
                  }`}
                  title={
                    cell.occupied
                      ? `Pos ${cell.position}: El ${cell.element_nr || "—"} / A ${cell.anode_nr || "—"} / C ${cell.cathode_nr || "—"}`
                      : `Pos ${cell.position}: empty`
                  }
                >
                  <div className="font-bold">{cell.position}</div>
                  <div className="truncate">{cell.occupied ? cell.element_nr || "•" : "—"}</div>
                </button>
              ))}
            </div>
          </div>

          <aside className="border-2 border-[var(--win-border-shadow)] [border-style:outset] bg-[var(--win-face)] p-3 text-xs">
            <div className="mb-2 font-bold text-[var(--win-navy)]">{t("arrangement.cellDetails")}</div>
            {!selected ? (
              <p className="text-[var(--win-muted)]">{t("arrangement.clickCell")}</p>
            ) : (
              <dl className="space-y-1.5">
                <div>
                  <dt className="font-bold">{t("fields.position")}</dt>
                  <dd>{selected.position}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.elementNr")}</dt>
                  <dd>{selected.element_nr || "—"}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.anodeNr")}</dt>
                  <dd>{selected.anode_nr || "—"}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.cathodeNr")}</dt>
                  <dd>{selected.cathode_nr || "—"}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.membraneType")}</dt>
                  <dd>{selected.membrane_type || "—"}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.membraneNr")}</dt>
                  <dd>{selected.membrane_nr || "—"}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.assemblyDate")}</dt>
                  <dd>{formatDate(selected.assembly_date)}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.commissioningDate")}</dt>
                  <dd>{formatDate(selected.commissioning_date)}</dd>
                </div>
                <div>
                  <dt className="font-bold">{t("fields.decommissioningDate")}</dt>
                  <dd>{formatDate(selected.decommissioning_date)}</dd>
                </div>
                {selected.element_id ? (
                  <Link
                    href={`/elements/assembly?element_nr=${encodeURIComponent(selected.element_nr || "")}`}
                    className="mt-2 inline-block font-semibold text-[var(--win-navy)] underline"
                  >
                    {t("menus.assemblyData")}
                  </Link>
                ) : null}
              </dl>
            )}

            {selected ? (
              <p className="mt-3 text-[11px] text-[var(--win-muted)]">{t("arrangement.editBelow")}</p>
            ) : null}

            {(data?.blocks || []).length > 0 && (
              <div className="mt-4 border-t border-[var(--win-border-shadow)] pt-2">
                <div className="mb-1 font-bold">{t("arrangement.blocks")}</div>
                <ul className="space-y-1 text-[11px]">
                  {data!.blocks.map((b) => (
                    <li key={b.id}>
                      {t("arrangement.blockLabel", {
                        block: b.block || "—",
                        start: b.start_position || "—",
                        end: b.end_position || "—",
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>
      )}
      {selected && currentEz ? (
        <CellArrangementEditor
          key={`${currentEz}-${selected.position}`}
          electrolyzer={currentEz}
          position={selected.position}
          onChanged={() => boardQuery.refetch()}
        />
      ) : null}
    </AccessFormWindow>
  );
}
