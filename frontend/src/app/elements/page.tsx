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
      <div
        className="grid max-w-[980px] gap-x-4 gap-y-3 pt-4"
        style={{ gridTemplateColumns: "repeat(5, minmax(140px, 1fr))" }}
      >
        <AccessBtn href="/elements/assembly">{t("menus.assemblyData")}</AccessBtn>
        <AccessBtn href="/settings?tab=groups">{t("menus.groupDefinition")}</AccessBtn>
        <AccessBtn href="/anodes">{t("menus.anodeDetails")}</AccessBtn>
        <AccessBtn href="/cathodes">{t("menus.cathodeDetails")}</AccessBtn>
        <AccessBtn href="/membranes">{t("menus.membraneDetails")}</AccessBtn>

        <AccessBtn href="/elements/assembly">{t("menus.importMontage")}</AccessBtn>
        <AccessBtn href="/settings?tab=inspection-reasons">{t("menus.inspectionReasons")}</AccessBtn>
        <AccessBtn href="/anodes">{t("menus.anodeMaintenance")}</AccessBtn>
        <AccessBtn href="/cathodes">{t("menus.cathodeMaintenance")}</AccessBtn>
        <AccessBtn href="/membranes">{t("menus.membraneMaintenance")}</AccessBtn>

        <AccessBtn href="/segregation">{t("menus.electrodeSegregation")}</AccessBtn>
        <AccessBtn href="/settings?tab=cell-components">{t("menus.cellComponents")}</AccessBtn>
        <AccessBtn href="/anodes">{t("menus.anodeRecoating")}</AccessBtn>
        <AccessBtn href="/cathodes">{t("menus.cathodeRecoating")}</AccessBtn>
        <span />

        <span />
        <span />
        <AccessBtn href="/anodes">{t("menus.checkAnodeCoating")}</AccessBtn>
        <AccessBtn href="/cathodes">{t("menus.checkCathodeCoating")}</AccessBtn>
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
