"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/context";
import { ElementCoatingTab } from "./element-dashboard-coating";
import { ElementInstalledTab } from "./element-dashboard-installed";
import { ElementIntegrityTab, ElementSettingsTab } from "./element-dashboard-integrity";
import { ElementOverviewTab, type DashTab, type OpenTarget } from "./element-dashboard-overview";
import { ElementPartsTab } from "./element-dashboard-parts";
import { ElementShopTab } from "./element-dashboard-shop";

/** The element management dashboard: one place for the whole life cycle of cells, anodes, cathodes and membranes. */
export function ElementDashboardPanel() {
  const { t } = useI18n();
  const [tab, setTab] = useState<DashTab>("overview");
  // A card on the overview opens another tab with its filter already set; the key remounts that tab so it starts from it.
  const [target, setTarget] = useState<OpenTarget>({ tab: "overview" });
  const [nonce, setNonce] = useState(0);

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
        { key: "shop", label: t("elDash.tab.shop"), content: <ElementShopTab key={`shop-${nonce}`} initialStage={target.tab === "shop" ? target.stage : undefined} /> },
        {
          key: "parts",
          label: t("elDash.tab.parts"),
          content: <ElementPartsTab key={`parts-${nonce}`} initial={target.tab === "parts" ? { kind: target.kind, life: target.life, where: target.where } : undefined} />,
        },
        { key: "installed", label: t("elDash.tab.installed"), content: <ElementInstalledTab /> },
        { key: "coating", label: t("elDash.tab.coating"), content: <ElementCoatingTab /> },
        { key: "integrity", label: t("elDash.tab.integrity"), content: <ElementIntegrityTab /> },
        { key: "settings", label: t("elDash.tab.settings"), content: <ElementSettingsTab /> },
      ]}
    />
  );
}
