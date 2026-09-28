"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText, Shield } from "lucide-react";
import { logsApi } from "@/lib/endpoints";
import type { AuditLog } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, Spinner } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDateTime } from "@/lib/utils";

const ACTION_COLORS: Record<string, "violet" | "cyan" | "emerald" | "rose" | "amber" | "slate"> = {
  create: "emerald",
  update: "cyan",
  delete: "rose",
  login: "violet",
  login_failed: "rose",
  password_change: "amber",
  password_change_failed: "rose",
  api: "slate",
};

function JsonBlock({ value, label }: { value: unknown; label: string }) {
  if (value == null) return null;
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold text-[var(--win-navy)]">{label}</div>
      <pre className="max-h-56 overflow-auto border border-[var(--win-border-shadow)] bg-[var(--win-input)] p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-all">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function LogsPage() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [q, setQ] = useState("");
  const [action, setAction] = useState("");
  const [resource, setResource] = useState("");
  const [username, setUsername] = useState("");
  const [successFilter, setSuccessFilter] = useState<"" | "true" | "false">("");
  const [skip, setSkip] = useState(0);
  const [selected, setSelected] = useState<AuditLog | null>(null);
  const limit = 100;

  const metaQuery = useQuery({
    queryKey: ["logs", "meta"],
    queryFn: logsApi.meta,
    enabled: isAdmin,
  });

  const listQuery = useQuery({
    queryKey: ["logs", "list", q, action, resource, username, successFilter, skip],
    queryFn: () =>
      logsApi.list({
        q: q || undefined,
        action: action || undefined,
        resource: resource || undefined,
        username: username || undefined,
        success: successFilter === "" ? undefined : successFilter === "true",
        skip,
        limit,
      }),
    enabled: isAdmin,
    refetchInterval: 15_000,
  });

  const columns: Column<AuditLog>[] = useMemo(
    () => [
      {
        key: "created_at",
        header: t("logs.time"),
        render: (r) => formatDateTime(r.created_at),
      },
      {
        key: "username",
        header: t("logs.user"),
        render: (r) => r.username || "—",
      },
      {
        key: "action",
        header: t("logs.action"),
        render: (r) => <Badge color={ACTION_COLORS[r.action] || "slate"}>{r.action}</Badge>,
      },
      {
        key: "resource",
        header: t("logs.resource"),
        render: (r) => (
          <span>
            {r.resource || "—"}
            {r.resource_id ? <span className="text-[var(--win-muted)]"> #{r.resource_id}</span> : null}
          </span>
        ),
      },
      {
        key: "summary",
        header: t("logs.summary"),
        render: (r) => r.summary || r.path || "—",
      },
      {
        key: "success",
        header: t("logs.result"),
        render: (r) => (
          <Badge color={r.success ? "emerald" : "rose"}>
            {r.success ? t("logs.success") : t("logs.failed")}
            {r.status_code != null ? ` ${r.status_code}` : ""}
          </Badge>
        ),
      },
      {
        key: "ip_address",
        header: t("logs.ip"),
        render: (r) => r.ip_address || "—",
      },
    ],
    [t]
  );

  if (!isAdmin) {
    return (
      <AccessFormWindow caption={t("logs.title")}>
        <ErrorState message={t("common.accessDenied")} />
      </AccessFormWindow>
    );
  }

  const total = listQuery.data?.total ?? 0;
  const page = Math.floor(skip / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));

  return (
    <AccessFormWindow
      caption={t("logs.title")}
      helpKey="logs"
      commands={
        <Button type="button" variant="secondary" onClick={() => listQuery.refetch()}>
          <RefreshCw size={14} /> {t("common.refresh")}
        </Button>
      }
    >
      <div className="mb-3 flex flex-wrap items-start gap-2 text-xs text-[var(--win-muted)]">
        <Shield size={14} className="mt-0.5 text-[var(--win-navy)]" />
        <p>{t("logs.description")}</p>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-2">
          <Label>{t("logs.search")}</Label>
          <Input
            value={q}
            onChange={(e) => {
              setSkip(0);
              setQ(e.target.value);
            }}
            placeholder={t("logs.searchPlaceholder")}
          />
        </div>
        <div>
          <Label>{t("logs.user")}</Label>
          <Input
            value={username}
            onChange={(e) => {
              setSkip(0);
              setUsername(e.target.value);
            }}
          />
        </div>
        <div>
          <Label>{t("logs.action")}</Label>
          <Select
            value={action}
            onChange={(e) => {
              setSkip(0);
              setAction(e.target.value);
            }}
          >
            <option value="">{t("logs.allActions")}</option>
            {(metaQuery.data?.actions || ["create", "update", "delete", "login", "api"]).map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("logs.resource")}</Label>
          <Select
            value={resource}
            onChange={(e) => {
              setSkip(0);
              setResource(e.target.value);
            }}
          >
            <option value="">{t("logs.allResources")}</option>
            {(metaQuery.data?.resources || []).map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>{t("logs.result")}</Label>
          <Select
            value={successFilter}
            onChange={(e) => {
              setSkip(0);
              setSuccessFilter(e.target.value as "" | "true" | "false");
            }}
          >
            <option value="">{t("logs.allResults")}</option>
            <option value="true">{t("logs.success")}</option>
            <option value="false">{t("logs.failed")}</option>
          </Select>
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs">
        <ScrollText size={14} />
        <span>
          {t("logs.total", { count: total })} — {t("logs.page", { page, pages })}
        </span>
      </div>

      {listQuery.isError ? (
        <ErrorState message={(listQuery.error as Error).message} />
      ) : listQuery.isLoading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={listQuery.data?.items}
          keyField="id"
          emptyTitle={t("logs.empty")}
          onRowClick={(row) => setSelected(row)}
        />
      )}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={skip <= 0} onClick={() => setSkip(Math.max(0, skip - limit))}>
          {t("common.previous")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={skip + limit >= total}
          onClick={() => setSkip(skip + limit)}
        >
          {t("common.next")}
        </Button>
      </div>

      {selected && (
        <Modal open onClose={() => setSelected(null)} title={t("logs.detailTitle", { id: selected.id })} wide>
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <span className="font-bold">{t("logs.time")}:</span> {formatDateTime(selected.created_at)}
              </div>
              <div>
                <span className="font-bold">{t("logs.user")}:</span> {selected.username || "—"} ({selected.user_role || "—"})
              </div>
              <div>
                <span className="font-bold">{t("logs.action")}:</span> {selected.action}
              </div>
              <div>
                <span className="font-bold">{t("logs.resource")}:</span> {selected.resource || "—"} / {selected.resource_id || "—"}
              </div>
              <div>
                <span className="font-bold">{t("logs.method")}:</span> {selected.method || "—"} {selected.path || ""}
              </div>
              <div>
                <span className="font-bold">{t("logs.ip")}:</span> {selected.ip_address || "—"}
              </div>
            </div>
            <p>
              <span className="font-bold">{t("logs.summary")}:</span> {selected.summary || "—"}
            </p>
            <JsonBlock value={selected.changes} label={t("logs.changes")} />
            <JsonBlock value={selected.before_data} label={t("logs.before")} />
            <JsonBlock value={selected.after_data} label={t("logs.after")} />
            <JsonBlock value={selected.request_body} label={t("logs.requestBody")} />
            {selected.user_agent ? (
              <p className="text-[var(--win-muted)]">
                <span className="font-bold">{t("logs.userAgent")}:</span> {selected.user_agent}
              </p>
            ) : null}
          </div>
        </Modal>
      )}
    </AccessFormWindow>
  );
}
