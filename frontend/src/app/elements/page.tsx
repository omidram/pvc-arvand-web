"use client";

import { AccessBtn, AccessHub } from "@/components/layout/access-hub";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";

export default function ElementAdministrationMenu() {
  const { canView } = useAuth();
  const { t } = useI18n();
  const ok = canView("elements");
  if (!ok) return null;

  return (
    <AccessHub title={t("elements.title")}>
      {/*
        Exact replica of the real Access frmZellenverwaltung (Element Administration)
        menu: 5 content columns + 1 reserved column on the right (used only by the
        far bottom-right "Element Inspection" button, mirroring its isolated position
        in the original form, well below the main 4-row grid).
      */}
      <div className="access-admin-grid pt-4">
        <AccessBtn href="/elements/assembly">{t("menus.assemblyData")}</AccessBtn>
        <AccessBtn href="/settings?tab=groups">{t("menus.groupDefinition")}</AccessBtn>
        <AccessBtn href="/anodes">{t("menus.anodeDetails")}</AccessBtn>
        <AccessBtn href="/cathodes">{t("menus.cathodeDetails")}</AccessBtn>
        <AccessBtn href="/membranes">{t("menus.membraneDetails")}</AccessBtn>
        <span />

        <AccessBtn href="/elements/assembly?import=montage">{t("menus.importMontage")}</AccessBtn>
        <AccessBtn href="/settings?tab=inspection-reasons">{t("menus.inspectionReasons")}</AccessBtn>
        <AccessBtn href="/anodes?tab=maintenance">{t("menus.anodeMaintenance")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=maintenance">{t("menus.cathodeMaintenance")}</AccessBtn>
        <AccessBtn href="/membranes?tab=maintenance">{t("menus.membraneMaintenance")}</AccessBtn>
        <span />

        <AccessBtn href="/segregation">{t("menus.electrodeSegregation")}</AccessBtn>
        <span />
        <AccessBtn href="/maintenance-reports?kind=anode">{t("menus.anodeMaintenanceReport")}</AccessBtn>
        <AccessBtn href="/maintenance-reports?kind=cathode">{t("menus.cathodeMaintenanceReport")}</AccessBtn>
        <AccessBtn href="/maintenance-reports?kind=membrane">{t("menus.membraneMaintenanceReport")}</AccessBtn>
        <span />

        <AccessBtn href="/elements/assembly?import=demontage">{t("menus.importDemontage")}</AccessBtn>
        <AccessBtn href="/elements/components">{t("menus.cellComponents")}</AccessBtn>
        <AccessBtn href="/anodes?tab=recoating">{t("menus.anodeRecoating")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=recoating">{t("menus.cathodeRecoating")}</AccessBtn>
        <span />
        <span />

        <span />
        <span />
        <AccessBtn href="/anodes?tab=coating">{t("menus.checkAnodeCoating")}</AccessBtn>
        <AccessBtn href="/cathodes?tab=coating">{t("menus.checkCathodeCoating")}</AccessBtn>
        <span />
        <span />
      </div>

      {/* Isolated bottom row, set apart from the main grid — matches the large
          vertical gap before these two buttons in the original Access form. */}
      <div className="access-admin-grid mt-10">
        <span />
        <span />
        <span />
        <span />
        <AccessBtn href="/statistics?form=dol">{t("menus.membraneStatistics")}</AccessBtn>
        <AccessBtn href="/inspections">{t("menus.elementInspection")}</AccessBtn>
      </div>
    </AccessHub>
  );
}
