"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, FolderOpen, RefreshCw } from "lucide-react";
import { databaseApi, type DatabaseFileInfo, type DatabaseStatus, type DatabaseSwitchPayload } from "@/lib/endpoints";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { DataTable, type Column } from "@/components/ui/data-table";
import { LoadingState, ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { formatDateTime } from "@/lib/utils";
import { appAlert, appConfirm } from "@/lib/dialog";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function emptyForm(status?: DatabaseStatus): DatabaseSwitchPayload {
  const online = status?.online || {};
  return {
    mode: status?.mode === "online" ? "online" : "local",
    kind: (online.kind as string) === "sqlite" ? "sqlite" : "postgresql",
    host: String(online.host || ""),
    port: Number(online.port || 5432),
    database: String(online.database || ""),
    username: String(online.username || ""),
    password: "",
    sqlite_path: String(online.sqlite_path || ""),
    url: String(online.url || ""),
    copy_data: true,
  };
}

function SwitchForm({ status }: { status: DatabaseStatus }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<DatabaseSwitchPayload>(() => emptyForm(status));
  const [testOk, setTestOk] = useState<string | null>(null);

  const testMutation = useMutation({
    mutationFn: () => databaseApi.test(form),
    onSuccess: (data) => setTestOk(t("database.testOk", { dialect: data.dialect })),
    onError: () => setTestOk(null),
  });

  const switchMutation = useMutation({
    mutationFn: () => databaseApi.switchTo(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["database-status"] });
    },
  });

  function set<K extends keyof DatabaseSwitchPayload>(key: K, value: DatabaseSwitchPayload[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setTestOk(null);
  }

  if (status.env_locked) {
    return <p className="text-sm text-[var(--win-muted)]">{t("database.envLocked")}</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--win-muted)]">{t("database.switchHelp")}</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2 font-semibold">
          <input type="radio" name="db-mode" checked={form.mode === "local"} onChange={() => set("mode", "local")} />
          {t("database.modeLocal")}
        </label>
        <label className="flex items-center gap-2 font-semibold">
          <input type="radio" name="db-mode" checked={form.mode === "online"} onChange={() => set("mode", "online")} />
          {t("database.modeOnline")}
        </label>
      </div>

      {form.mode === "online" && (
        <>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="db-kind"
                checked={form.kind === "postgresql"}
                onChange={() => set("kind", "postgresql")}
              />
              {t("database.kindPostgres")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="db-kind" checked={form.kind === "sqlite"} onChange={() => set("kind", "sqlite")} />
              {t("database.kindSqlite")}
            </label>
          </div>

          {form.kind === "sqlite" ? (
            <div>
              <Label>{t("database.sqlitePath")}</Label>
              <Input
                value={form.sqlite_path || ""}
                placeholder={t("database.sqlitePathPlaceholder")}
                onChange={(e) => set("sqlite_path", e.target.value)}
              />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label>{t("database.host")}</Label>
                <Input value={form.host || ""} onChange={(e) => set("host", e.target.value)} />
              </div>
              <div>
                <Label>{t("database.port")}</Label>
                <Input type="number" value={form.port || 5432} onChange={(e) => set("port", Number(e.target.value) || 5432)} />
              </div>
              <div>
                <Label>{t("database.dbName")}</Label>
                <Input value={form.database || ""} onChange={(e) => set("database", e.target.value)} />
              </div>
              <div>
                <Label>{t("database.username")}</Label>
                <Input value={form.username || ""} onChange={(e) => set("username", e.target.value)} />
              </div>
              <div className="sm:col-span-2">
                <Label>{t("database.password")}</Label>
                <Input
                  type="password"
                  value={form.password || ""}
                  placeholder={status.online?.password_set ? t("database.passwordKept") : ""}
                  onChange={(e) => set("password", e.target.value)}
                />
              </div>
            </div>
          )}

          <div>
            <Label>{t("database.advancedUrl")}</Label>
            <Input
              value={form.url || ""}
              placeholder={t("database.advancedUrlPlaceholder")}
              onChange={(e) => set("url", e.target.value)}
            />
            <p className="mt-1 text-xs text-[var(--win-muted)]">{t("database.advancedUrlHelp")}</p>
          </div>
        </>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!form.copy_data} onChange={(e) => set("copy_data", e.target.checked)} />
        {t("database.copyData")}
      </label>

      <div className="flex flex-wrap items-center gap-2">
        {form.mode === "online" && (
          <Button type="button" variant="secondary" disabled={testMutation.isPending} onClick={() => testMutation.mutate()}>
            {testMutation.isPending ? t("database.testing") : t("database.test")}
          </Button>
        )}
        <Button
          type="button"
          disabled={switchMutation.isPending}
          onClick={() => {
            void appConfirm(t("database.confirmSwitch")).then((ok) => {
              if (ok) switchMutation.mutate();
            });
          }}
        >
          <RefreshCw size={14} /> {switchMutation.isPending ? t("database.switching") : t("database.switch")}
        </Button>
      </div>
      {testOk && <p className="text-xs font-semibold text-[#0d5c0d]">{testOk}</p>}
      {testMutation.isError && <ErrorState message={(testMutation.error as Error).message} />}
      {switchMutation.isSuccess && (
        <p className="text-xs font-semibold text-[#0d5c0d]">{t("database.switchOk")}</p>
      )}
      {switchMutation.isError && <ErrorState message={(switchMutation.error as Error).message} />}
    </div>
  );
}

export function DatabaseTab() {
  const { t } = useI18n();
  const statusQuery = useQuery({ queryKey: ["database-status"], queryFn: databaseApi.status });
  const revealMutation = useMutation({
    mutationFn: (path: string) => databaseApi.reveal(path),
  });
  const downloadMutation = useMutation({
    mutationFn: databaseApi.download,
  });

  const status = statusQuery.data;
  const fileColumns: Column<DatabaseFileInfo>[] = useMemo(
    () => [
      {
        key: "label",
        header: t("database.file"),
        render: (r) => {
          const translated = t(`database.fileLabel.${r.key}`);
          const label = translated.startsWith("database.") ? r.label : translated;
          return r.in_use ? `${label} · ${t("database.inUse")}` : label;
        },
      },
      { key: "section", header: t("database.section"), render: (r) => t(`database.fileSection.${r.section}`) },
      { key: "path", header: t("database.path"), className: "font-mono" },
      { key: "size_bytes", header: t("database.size"), render: (r) => formatBytes(r.size_bytes) },
      {
        key: "modified_at",
        header: t("database.modified"),
        render: (r) => (r.modified_at ? formatDateTime(r.modified_at) : "—"),
      },
    ],
    [t]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("database.currentTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {statusQuery.isLoading ? (
            <LoadingState />
          ) : statusQuery.isError ? (
            <ErrorState message={(statusQuery.error as Error).message} />
          ) : status ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="font-bold">{t("database.mode")}: </span>
                {t(`database.modeValue.${status.mode}`)}
              </p>
              <p>
                <span className="font-bold">{t("database.dialect")}: </span>
                {status.dialect}
              </p>
              <p className="break-all">
                <span className="font-bold">{t("database.connection")}: </span>
                <span className="font-mono text-xs">{status.url_display}</span>
              </p>
              <p className="break-all">
                <span className="font-bold">{t("database.dataFolder")}: </span>
                <span className="font-mono text-xs">{status.data_directory}</span>
              </p>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button type="button" onClick={() => downloadMutation.mutate()} disabled={downloadMutation.isPending}>
                  <Download size={14} /> {downloadMutation.isPending ? t("database.downloading") : t("database.downloadAll")}
                </Button>
                <Button type="button" variant="secondary" onClick={() => revealMutation.mutate(status.data_directory)}>
                  <FolderOpen size={14} /> {t("database.openFolder")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => navigator.clipboard.writeText(status.data_directory)}
                >
                  <Copy size={14} /> {t("database.copyPath")}
                </Button>
              </div>
              {downloadMutation.isError && <ErrorState message={(downloadMutation.error as Error).message} />}
              {revealMutation.isError && <ErrorState message={(revealMutation.error as Error).message} />}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("database.filesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--win-muted)]">{t("database.filesHelp")}</p>
          <DataTable<DatabaseFileInfo>
            columns={fileColumns}
            data={status?.files}
            keyField="key"
            isLoading={statusQuery.isLoading}
            emptyTitle={t("common.noRecordsFound")}
            actions={(row) => (
              <>
                <Button size="sm" variant="ghost" title={t("database.copyPath")} onClick={() => navigator.clipboard.writeText(row.path)}>
                  <Copy size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  title={t("database.openFolder")}
                  disabled={!row.exists}
                  onClick={() => revealMutation.mutate(row.path)}
                >
                  <FolderOpen size={14} />
                </Button>
              </>
            )}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("database.sectionsTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--win-muted)]">{t("database.sectionsHelp")}</p>
          {statusQuery.isLoading ? (
            <LoadingState />
          ) : (
            <div className="space-y-3">
              {status?.sections.map((section) => (
                <details key={section.key} className="border-2 border-[var(--win-face-dark)] bg-[var(--win-panel)]">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-[var(--win-navy)]">
                    {t(`database.sectionLabel.${section.key}`)} — {t("database.tableCount", { count: section.table_count })} ·{" "}
                    {t("database.rowCount", { count: section.row_count })}
                  </summary>
                  <div className="border-t-2 border-[var(--win-face-dark)] p-2">
                    <DataTable
                      columns={[
                        { key: "name", header: t("database.table"), className: "font-mono" },
                        { key: "rows", header: t("database.rows") },
                      ]}
                      data={section.tables}
                      keyField="name"
                      emptyTitle={t("common.noRecordsFound")}
                    />
                  </div>
                </details>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("database.switchTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          {status ? <SwitchForm key={`${status.mode}:${status.url_display}`} status={status} /> : statusQuery.isLoading ? <LoadingState /> : null}
        </CardContent>
      </Card>
    </div>
  );
}
