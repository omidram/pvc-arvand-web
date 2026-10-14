"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/context";
import { CellRequestsTab } from "./cell-request";
import { ElementCellsTab } from "./element-dashboard-cells";
import { ElementCoatingTab } from "./element-dashboard-coating";
import { ElementInstalledTab } from "./element-dashboard-installed";
import { ElementIntegrityTab, ElementSettingsTab } from "./element-dashboard-integrity";
import { ElementFlowTab } from "./element-dashboard-flow";
import { ElementOverviewTab, type DashTab, type OpenTarget } from "./element-dashboard-overview";
import { ElementPartsTab } from "./element-dashboard-parts";
import { ElementShopTab } from "./element-dashboard-shop";

const TABS: DashTab[] = ["overview", "flow", "requests", "shop", "parts", "installed", "cells", "coating", "integrity", "settings"];
const KINDS = ["anode", "cathode", "membrane"] as const;

/** The element management dashboard: one place for the whole life cycle of cells, anodes, cathodes and membranes. */
export function ElementDashboardPanel() {
  const { t } = useI18n();
  const params = useSearchParams();
  // Links from the Main Menu report open a tab with its filter already set: ?tab=shop&stage=ready
  const fromUrl = ((): OpenTarget => {
    const tab = params.get("tab");
    if (!tab || !TABS.includes(tab as DashTab)) return { tab: "overview" };
    const kind = params.get("kind");
    return {
      tab: tab as DashTab,
      stage: params.get("stage") ?? undefined,
      kind: KINDS.find((k) => k === kind),
      life: params.get("life") ?? undefined,
      where: params.get("where") ?? undefined,
      due: params.get("due") ?? undefined,
    };
  })();
  const requestId = Number(params.get("req")) || undefined;
  const [tab, setTab] = useState<DashTab>(fromUrl.tab);
  // A card on the overview opens another tab with its filter already set; the key remounts that tab so it starts from it.
  const [target, setTarget] = useState<OpenTarget>(fromUrl);
  const [nonce, setNonce] = useState(0);
  const [seenRequest, setSeenRequest] = useState(requestId);
  if (requestId !== seenRequest) {
    setSeenRequest(requestId);
    if (requestId) {
      setTarget({ tab: "requests" });
      setTab("requests");
    }
  }

  function open(next: OpenTarget) {
    setTarget(next);
    setNonce((n) => n + 1);
    setTab(next.tab);
  }

  return (
    <Tabs
      activeKey={tab}
      onChange={(key) => {
        setTarget({ tab: key as DashTab });
        setNonce((n) => n + 1);
        setTab(key as DashTab);
      }}
      tabs={[
        { key: "overview", label: t("elDash.tab.overview"), content: <ElementOverviewTab onOpen={open} /> },
        { key: "flow", label: t("elDash.tab.flow"), content: <ElementFlowTab key={`flow-${nonce}`} onOpen={open} /> },
        {
          key: "requests",
          label: t("elDash.tab.requests"),
          content: <CellRequestsTab key={`requests-${nonce}-${requestId ?? ""}`} initialId={target.tab === "requests" ? requestId : undefined} />,
        },
        { key: "shop", label: t("elDash.tab.shop"), content: <ElementShopTab key={`shop-${nonce}`} initialStage={target.tab === "shop" ? target.stage : undefined} /> },
        {
          key: "parts",
          label: t("elDash.tab.parts"),
          content: <ElementPartsTab key={`parts-${nonce}`} initial={target.tab === "parts" ? { kind: target.kind, life: target.life, where: target.where, due: target.due } : undefined} />,
        },
        { key: "installed", label: t("elDash.tab.installed"), content: <ElementInstalledTab /> },
        { key: "cells", label: t("elDash.tab.cells"), content: <ElementCellsTab key={`cells-${nonce}`} initialTrain={params.get("train") ?? undefined} /> },
        { key: "coating", label: t("elDash.tab.coating"), content: <ElementCoatingTab /> },
        { key: "integrity", label: t("elDash.tab.integrity"), content: <ElementIntegrityTab /> },
        { key: "settings", label: t("elDash.tab.settings"), content: <ElementSettingsTab /> },
      ]}
    />
  );
}
