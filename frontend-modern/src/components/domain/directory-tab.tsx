"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { directoryApi, type DirectorySettings, type DirectoryStatus } from "@/lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";

function lines(value: string[] | undefined): string {
  return (value || []).join("\n");
}

function DirectoryForm({ status }: { status: DirectoryStatus }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const initial = status.settings;
  const [form, setForm] = useState<DirectorySettings>({ ...initial, bind_password: "" });
  const [usersText, setUsersText] = useState(lines(initial.allowed_users));
  const [groupsText, setGroupsText] = useState(lines(initial.allowed_groups));
  const [checkName, setCheckName] = useState(status.windows?.sam || "");

  function set<K extends keyof DirectorySettings>(key: K, value: DirectorySettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function payload(): DirectorySettings {
    return {
      ...form,
      allowed_users: usersText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
      allowed_groups: groupsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    };
  }

  const saveMutation = useMutation({
    mutationFn: () => directoryApi.save(payload()),
    onSuccess: (data) => {
      queryClient.setQueryData(["directory-status"], { ...status, settings: data.settings });
      setForm({ ...data.settings, bind_password: "" });
      setUsersText(lines(data.settings.allowed_users));
      setGroupsText(lines(data.settings.allowed_groups));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => directoryApi.test(payload()),
  });

  const checkMutation = useMutation({
    mutationFn: () => directoryApi.checkUser(checkName.trim()),
  });

  const windows = status.windows;
  const current = status.current_user;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("directory.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-xs text-[var(--win-muted)]">{t("directory.description")}</p>
          {windows?.account && (
            <p>
              <span className="font-bold">{t("directory.windowsUser")}: </span>
              <span className="font-mono">{windows.account}</span>
              {current && (
                <span className={current.ok ? " ms-2 font-semibold text-[#0d5c0d]" : " ms-2 font-semibold text-[var(--win-danger)]"}>
                  {current.ok ? t("directory.currentAllowed") : t("directory.currentDenied")}
                </span>
              )}
            </p>
          )}
          <label className="flex items-center gap-2 font-semibold">
            <input type="checkbox" checked={!!form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
            {t("directory.enable")}
          </label>
          <p className="text-xs text-[var(--win-danger)]">{t("directory.lockoutWarning")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("directory.connectionTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{t("directory.host")}</Label>
            <Input value={form.host} placeholder="dc.plant.local" onChange={(e) => set("host", e.target.value)} />
          </div>
          <div>
            <Label>{t("directory.port")}</Label>
            <Input type="number" value={form.port} onChange={(e) => set("port", Number(e.target.value) || 389)} />
          </div>
          <div>
            <Label>{t("directory.domain")}</Label>
            <Input value={form.domain} placeholder="PLANT" onChange={(e) => set("domain", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>{t("directory.baseDn")}</Label>
            <Input value={form.base_dn} placeholder="DC=plant,DC=local" onChange={(e) => set("base_dn", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.use_ssl} onChange={(e) => set("use_ssl", e.target.checked)} />
            {t("directory.useSsl")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!form.use_starttls} onChange={(e) => set("use_starttls", e.target.checked)} />
            {t("directory.useStartTls")}
          </label>
          <div>
            <Label>{t("directory.bindUsername")}</Label>
            <Input value={form.bind_username} onChange={(e) => set("bind_username", e.target.value)} />
          </div>
          <div>
            <Label>{t("directory.bindPassword")}</Label>
            <Input
              type="password"
              value={form.bind_password || ""}
              placeholder={form.bind_password_set ? t("directory.passwordKept") : ""}
              onChange={(e) => set("bind_password", e.target.value)}
            />
          </div>
          <p className="sm:col-span-2 text-xs text-[var(--win-muted)]">{t("directory.bindHelp")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("directory.listTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>{t("directory.allowedUsers")}</Label>
            <textarea
              className="min-h-[120px] w-full border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)] px-2 py-1 font-mono text-sm"
              value={usersText}
              placeholder={t("directory.allowedUsersPlaceholder")}
              onChange={(e) => setUsersText(e.target.value)}
            />
          </div>
          <div>
            <Label>{t("directory.allowedGroups")}</Label>
            <textarea
              className="min-h-[120px] w-full border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)] px-2 py-1 font-mono text-sm"
              value={groupsText}
              placeholder={t("directory.allowedGroupsPlaceholder")}
              onChange={(e) => setGroupsText(e.target.value)}
            />
          </div>
          <p className="sm:col-span-2 text-xs text-[var(--win-muted)]">{t("directory.listHelp")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("directory.optionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.enforce_at_startup}
              onChange={(e) => set("enforce_at_startup", e.target.checked)}
            />
            {t("directory.enforceStartup")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!form.allow_local_fallback}
              onChange={(e) => set("allow_local_fallback", e.target.checked)}
            />
            {t("directory.localFallback")}
          </label>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
          {testMutation.isPending ? t("directory.testing") : t("directory.test")}
        </Button>
        <Button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          <Save size={14} /> {saveMutation.isPending ? t("common.saving") : t("common.save")}
        </Button>
      </div>
      {testMutation.isSuccess && (
        <p className="text-xs font-semibold text-[#0d5c0d]">
          {t("directory.testOk", { who: testMutation.data.bound_as || form.host })}
        </p>
      )}
      {testMutation.isError && <ErrorState message={(testMutation.error as Error).message} />}
      {saveMutation.isSuccess && <p className="text-xs font-semibold text-[#0d5c0d]">{t("directory.saved")}</p>}
      {saveMutation.isError && <ErrorState message={(saveMutation.error as Error).message} />}

      <Card>
        <CardHeader>
          <CardTitle>{t("directory.checkTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1">
              <Label>{t("auth.username")}</Label>
              <Input value={checkName} onChange={(e) => setCheckName(e.target.value)} />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={!checkName.trim() || checkMutation.isPending}
              onClick={() => checkMutation.mutate()}
            >
              {t("directory.check")}
            </Button>
          </div>
          {checkMutation.isSuccess && (
            <p className={checkMutation.data.ok ? "text-xs font-semibold text-[#0d5c0d]" : "text-xs font-semibold text-[var(--win-danger)]"}>
              {checkMutation.data.reason}
            </p>
          )}
          {checkMutation.isError && <ErrorState message={(checkMutation.error as Error).message} />}
        </CardContent>
      </Card>
    </div>
  );
}

export function DirectoryTab() {
  const statusQuery = useQuery({ queryKey: ["directory-status"], queryFn: directoryApi.status });
  if (statusQuery.isLoading) return <LoadingState />;
  if (statusQuery.isError) return <ErrorState message={(statusQuery.error as Error).message} />;
  if (!statusQuery.data) return null;
  return <DirectoryForm key={String(statusQuery.data.settings.updated_at || "new")} status={statusQuery.data} />;
}
