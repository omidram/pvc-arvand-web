"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { usersApi } from "@/lib/endpoints";
import type { PermissionLevel, UserAccount, UserRole } from "@/lib/types";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/spinner";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";

const ROLE_COLORS: Record<UserRole, "violet" | "cyan" | "slate"> = { admin: "violet", user: "cyan", visitor: "slate" };

export default function UsersPage() {
  const { t } = useI18n();
  const { isAdmin, user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);

  const formKeysQuery = useQuery({ queryKey: ["users", "form-keys"], queryFn: usersApi.formKeys, enabled: isAdmin });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: usersApi.list, enabled: isAdmin });

  const removeMutation = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

  if (!isAdmin) {
    return (
      <div>
        <PageHeader title={t("users.title")} description={t("users.description")} />
        <ErrorState message={t("common.accessDenied")} />
      </div>
    );
  }

  function handleDelete(u: UserAccount) {
    if (currentUser?.id === u.id) {
      alert(t("users.cannotDeleteSelf"));
      return;
    }
    if (confirm(t("users.confirmDelete", { name: u.username }))) removeMutation.mutate(u.id);
  }

  const columns: Column<UserAccount>[] = [
    { key: "username", header: t("users.username") },
    { key: "full_name", header: t("users.fullName"), render: (r) => r.full_name || "—" },
    { key: "role", header: t("users.role"), render: (r) => <Badge color={ROLE_COLORS[r.role]}>{t(`enums.role.${r.role}`)}</Badge> },
    {
      key: "auth_source",
      header: t("users.source"),
      render: (r) => (r.auth_source === "ad" ? t("users.sourceAd") : t("users.sourceLocal")),
    },
    {
      key: "is_active",
      header: t("users.active"),
      render: (r) => <Badge color={r.is_active ? "emerald" : "rose"}>{r.is_active ? t("users.active") : t("users.inactive")}</Badge>,
    },
    { key: "created_at", header: t("fields.date"), render: (r) => formatDate(r.created_at) },
  ];

  return (
    <div>
      <PageHeader
        title={t("users.title")}
        description={t("users.description")}
        helpKey="users"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            <Plus size={16} /> {t("users.newUser")}
          </Button>
        }
      />

      {usersQuery.isError ? (
        <ErrorState message={(usersQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={usersQuery.data}
          keyField="id"
          isLoading={usersQuery.isLoading}
          emptyTitle={t("users.noUsersFound")}
          actions={(row) => (
            <>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(row);
                  setShowForm(true);
                }}
              >
                <Pencil size={14} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => handleDelete(row)}>
                <Trash2 size={14} className="text-[var(--win-danger)]" />
              </Button>
            </>
          )}
        />
      )}

      {showForm && formKeysQuery.data && (
        <Modal open onClose={() => setShowForm(false)} title={editing ? t("users.editUser") : t("users.newUser")} wide>
          <UserForm
            formKeys={formKeysQuery.data}
            initial={editing}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ["users"] });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function UserForm({
  formKeys,
  initial,
  onCancel,
  onSaved,
}: {
  formKeys: string[];
  initial: UserAccount | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initial?.username || "");
  const [fullName, setFullName] = useState(initial?.full_name || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(initial?.role || "user");
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [permissions, setPermissions] = useState<Record<string, PermissionLevel>>(
    () => Object.fromEntries(formKeys.map((k) => [k, initial?.permissions?.[k] || "none"])) as Record<string, PermissionLevel>
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      usersApi.create({ username, full_name: fullName || undefined, password, role, is_active: isActive, permissions }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      usersApi.update(initial!.id, {
        full_name: fullName || undefined,
        role,
        is_active: isActive,
        password: password || undefined,
        permissions,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  function applyTemplate(level: PermissionLevel) {
    setPermissions(Object.fromEntries(formKeys.map((k) => [k, level])) as Record<string, PermissionLevel>);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (initial) updateMutation.mutate();
    else createMutation.mutate();
  }

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t("users.username")}</Label>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} required disabled={!!initial} />
        </div>
        <div>
          <Label>{t("users.fullName")}</Label>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </div>
        <div>
          <Label>
            {t("users.password")} {initial && <span className="font-normal normal-case">({t("users.passwordHint")})</span>}
          </Label>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required={!initial} />
        </div>
        <div>
          <Label>{t("users.role")}</Label>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
            <option value="admin">{t("enums.role.admin")}</option>
            <option value="user">{t("enums.role.user")}</option>
            <option value="visitor">{t("enums.role.visitor")}</option>
          </Select>
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input id="is_active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <Label htmlFor="is_active" className="mb-0">
            {t("users.active")}
          </Label>
        </div>
      </div>

      {role !== "admin" && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <Label className="mb-0">{t("users.permissions")}</Label>
            <div className="flex gap-1.5">
              <Button type="button" size="sm" variant="secondary" onClick={() => applyTemplate("edit")}>
                {t("users.templateFullAccess")}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => applyTemplate("view")}>
                {t("users.templateViewAll")}
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => applyTemplate("none")}>
                {t("users.templateNone")}
              </Button>
            </div>
          </div>
          <div className="max-h-64 overflow-y-auto border-2 border-[var(--win-border-shadow)] rounded-lg bg-[var(--win-input)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-[var(--win-face)]">
                <tr>
                  <th className="border-b-2 border-[var(--win-border-shadow)] px-2 py-1 text-start font-bold">{t("users.form")}</th>
                  <th className="border-b-2 border-[var(--win-border-shadow)] px-2 py-1 text-start font-bold">{t("users.accessLevel")}</th>
                </tr>
              </thead>
              <tbody>
                {formKeys.map((key) => (
                  <tr key={key} className="odd:bg-[var(--win-row-alt)]">
                    <td className="px-2 py-1 font-semibold text-[var(--win-text)]">{t(`nav.${key}`)}</td>
                    <td className="px-2 py-1">
                      <Select
                        value={permissions[key] || "none"}
                        onChange={(e) => setPermissions((prev) => ({ ...prev, [key]: e.target.value as PermissionLevel }))}
                        className="max-w-[160px]"
                      >
                        <option value="none">{t("enums.permissionLevel.none")}</option>
                        <option value="view">{t("enums.permissionLevel.view")}</option>
                        <option value="edit">{t("enums.permissionLevel.edit")}</option>
                      </Select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {error && <div className="text-xs font-semibold text-[var(--win-danger)]">{error}</div>}

      <div className="flex justify-end gap-2 border-t border-[var(--win-border-shadow)] pt-3">
        <Button type="button" variant="secondary" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
