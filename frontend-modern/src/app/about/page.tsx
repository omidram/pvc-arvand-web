"use client";

import Image from "next/image";
import { ShieldCheck, FileText, Lock, Database, ScrollText } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/context";

const APP_VERSION = "1.0.0";

export default function AboutPage() {
  const { t } = useI18n();

  const legalDocs = [
    { key: "license", icon: ScrollText },
    { key: "eula", icon: FileText },
    { key: "terms", icon: FileText },
    { key: "privacy", icon: Lock },
    { key: "security", icon: ShieldCheck },
  ] as const;

  const trustPoints = ["auth", "rbac", "localData", "noExternalAi", "auditability"] as const;

  return (
    <div>
      <PageHeader title={t("about.title")} description={t("about.description")} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardContent className="flex flex-col items-center gap-3 py-6 text-center">
            <div className="flex h-20 w-56 items-center justify-center overflow-hidden border-2 border-[var(--win-border-shadow)] bg-[var(--win-logo-bg)] p-2.5 shadow-sm">
              <Image src="/logo.png" alt="Arvand Petrochemical Company" width={224} height={80} className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="text-base font-bold text-[var(--win-navy)]">{t("app.name")}</div>
              <div className="text-xs text-[var(--win-muted)]">{t("app.subtitle")}</div>
            </div>
            <div className="text-xs text-[var(--win-muted)]">{t("about.version", { version: APP_VERSION })}</div>
            <div className="text-xs font-semibold text-[var(--win-navy)]">{t("about.company")}</div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("about.trustTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              {trustPoints.map((key) => (
                <li key={key} className="flex items-start gap-2">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--win-navy)]" />
                  <span>{t(`about.trust.${key}`)}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("about.legalTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-[var(--win-muted)]">{t("about.legalDescription")}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {legalDocs.map(({ key, icon: Icon }) => (
                <div
                  key={key}
                  className="flex items-start gap-2.5 border-2 border-[var(--win-border-shadow)] bg-[var(--win-face)] px-3 py-2.5 rounded-lg"
                >
                  <Icon size={16} className="mt-0.5 shrink-0 text-[var(--win-navy)]" />
                  <div>
                    <div className="text-xs font-bold text-[var(--win-navy)]">{t(`about.docs.${key}.title`)}</div>
                    <div className="mt-0.5 text-[11px] text-[var(--win-muted)]">{t(`about.docs.${key}.summary`)}</div>
                    <div className="mt-1 font-mono text-[10px] text-[var(--win-muted)]">{t(`about.docs.${key}.file`)}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t("about.dataTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-2.5 text-sm">
              <Database size={16} className="mt-0.5 shrink-0 text-[var(--win-navy)]" />
              <p>{t("about.dataDescription")}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
