"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { rolesApi, usersApi } from "@/lib/endpoints";
import type { AppRole, PermissionLevel, UserAccount, UserRole } from "@/lib/types";
import { AccessFormWindow } from "@/components/layout/access-form";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState, Spinner } from "@/components/ui/spinner";
import { Tabs } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n/context";
import { useAuth } from "@/lib/auth/context";
import { formatDate } from "@/lib/utils";

const ROLE_COLORS: Record<UserRole, "violet" | "cyan" | "slate"> = { admin: "violet", user: "cyan", visitor: "slate" };

function PermissionMatrix({
  formKeys,
  permissions,
  onChange,
}: {
  formKeys: string[];
  permissions: Record<string, PermissionLevel>;
  onChange: (next: Record<string, PermissionLevel>) => void;
}) {
  const { t } = useI18n();

  function applyTemplate(level: PermissionLevel) {
    onChange(Object.fromEntries(formKeys.map((k) => [k, level])) as Record<string, PermissionLevel>);
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Label className="mb-0">{t("users.menuAccess")}</Label>
        <div className="flex flex-wrap gap-1.5">
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
      <p className="mb-2 text-[11px] text-[var(--win-muted)]">{t("users.menuAccessHint")}</p>
      <div className="max-h-64 overflow-y-auto border-2 border-[var(--win-border-shadow)] [border-style:inset] bg-[var(--win-input)]">
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
                    onChange={(e) => onChange({ ...permissions, [key]: e.target.value as PermissionLevel })}
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
  );
}

function UsersTab({ formKeys }: { formKeys: string[] }) {
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<UserAccount | null>(null);

  const usersQuery = useQuery({ queryKey: ["users"], queryFn: usersApi.list });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });

  const removeMutation = useMutation({
    mutationFn: (id: number) => usersApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["users"] }),
  });

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
    {
      key: "role",
      header: t("users.systemRole"),
      render: (r) => <Badge color={ROLE_COLORS[r.role]}>{t(`enums.role.${r.role}`)}</Badge>,
    },
    {
      key: "role_name",
      header: t("users.appRole"),
      render: (r) => r.role_name || (r.role === "admin" ? "—" : t("users.customPermissions")),
    },
    {
      key: "auth_source",
      header: t("users.source"),
      render: (r) => (r.auth_source === "ad" ? t("users.sourceAd") : t("users.sourceLocal")),
    },
    {
      key: "is_active",
      header: t("users.active"),
      render: (r) => (
        <Badge color={r.is_active ? "emerald" : "rose"}>{r.is_active ? t("users.active") : t("users.inactive")}</Badge>
      ),
    },
    { key: "created_at", header: t("fields.date"), render: (r) => formatDate(r.created_at) },
  ];

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} /> {t("users.newUser")}
        </Button>
      </div>

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

      {showForm && (
        <Modal open onClose={() => setShowForm(false)} title={editing ? t("users.editUser") : t("users.newUser")} wide>
          <UserForm
            formKeys={formKeys}
            roles={rolesQuery.data || []}
            initial={editing}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ["users"] });
              queryClient.invalidateQueries({ queryKey: ["roles"] });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function RolesTab({ formKeys }: { formKeys: string[] }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<AppRole | null>(null);

  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: rolesApi.list });

  const removeMutation = useMutation({
    mutationFn: (id: number) => rolesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roles"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (e: Error) => alert(e.message),
  });

  function handleDelete(role: AppRole) {
    if (role.is_system) {
      alert(t("users.cannotDeleteSystemRole"));
      return;
    }
    if (confirm(t("users.confirmDeleteRole", { name: role.name }))) removeMutation.mutate(role.id);
  }

  const columns: Column<AppRole>[] = [
    { key: "name", header: t("users.roleName") },
    { key: "description", header: t("users.roleDescription"), render: (r) => r.description || "—" },
    {
      key: "is_system",
      header: t("users.roleType"),
      render: (r) => (
        <Badge color={r.is_system ? "violet" : "cyan"}>
          {r.is_system ? t("users.systemRoleBadge") : t("users.customRoleBadge")}
        </Badge>
      ),
    },
    { key: "user_count", header: t("users.assignedUsers"), render: (r) => String(r.user_count) },
    {
      key: "permissions",
      header: t("users.visibleMenus"),
      render: (r) => {
        const visible = formKeys.filter((k) => (r.permissions[k] || "none") !== "none");
        return visible.length ? visible.map((k) => t(`nav.${k}`)).join(", ") : t("users.templateNone");
      },
    },
  ];

  return (
    <div className="space-y-3">
      <p className="text-xs text-[var(--win-muted)]">{t("users.rolesTabHint")}</p>
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setEditing(null);
            setShowForm(true);
          }}
        >
          <Plus size={16} /> {t("users.newRole")}
        </Button>
      </div>

      {rolesQuery.isError ? (
        <ErrorState message={(rolesQuery.error as Error).message} />
      ) : (
        <DataTable
          columns={columns}
          data={rolesQuery.data}
          keyField="id"
          isLoading={rolesQuery.isLoading}
          emptyTitle={t("users.noRolesFound")}
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
              <Button size="sm" variant="ghost" onClick={() => handleDelete(row)} disabled={row.is_system}>
                <Trash2 size={14} className="text-[var(--win-danger)]" />
              </Button>
            </>
          )}
        />
      )}

      {showForm && (
        <Modal open onClose={() => setShowForm(false)} title={editing ? t("users.editRole") : t("users.newRole")} wide>
          <RoleForm
            formKeys={formKeys}
            initial={editing}
            onCancel={() => setShowForm(false)}
            onSaved={() => {
              setShowForm(false);
              queryClient.invalidateQueries({ queryKey: ["roles"] });
              queryClient.invalidateQueries({ queryKey: ["users"] });
            }}
          />
        </Modal>
      )}
    </div>
  );
}

export default function UsersPage() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();

  const formKeysQuery = useQuery({ queryKey: ["users", "form-keys"], queryFn: usersApi.formKeys, enabled: isAdmin });

  if (!isAdmin) {
    return (
      <div>
        <AccessFormWindow caption={t("users.title")}>
          <ErrorState message={t("common.accessDenied")} />
        </AccessFormWindow>
      </div>
    );
  }

  const formKeys = formKeysQuery.data || [];

  return (
    <AccessFormWindow caption={t("users.title")} helpKey="users">
      {formKeysQuery.isError ? (
        <ErrorState message={(formKeysQuery.error as Error).message} />
      ) : formKeysQuery.isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <Tabs
          tabs={[
            { key: "users", label: t("users.tabUsers"), content: <UsersTab formKeys={formKeys} /> },
            { key: "roles", label: t("users.tabRoles"), content: <RolesTab formKeys={formKeys} /> },
          ]}
        />
      )}
    </AccessFormWindow>
  );
}

function UserForm({
  formKeys,
  roles,
  initial,
  onCancel,
  onSaved,
}: {
  formKeys: string[];
  roles: AppRole[];
  initial: UserAccount | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [username, setUsername] = useState(initial?.username || "");
  const [fullName, setFullName] = useState(initial?.full_name || "");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>(initial?.role || "user");
  const [roleId, setRoleId] = useState<number | null>(initial?.role_id ?? null);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [permissions, setPermissions] = useState<Record<string, PermissionLevel>>(
    () => Object.fromEntries(formKeys.map((k) => [k, initial?.permissions?.[k] || "none"])) as Record<string, PermissionLevel>
  );
  const [error, setError] = useState<string | null>(null);

  const usingAppRole = role !== "admin" && roleId != null;

  const createMutation = useMutation({
    mutationFn: () =>
      usersApi.create({
        username,
        full_name: fullName || undefined,
        password,
        role,
        role_id: role === "admin" ? null : roleId,
        is_active: isActive,
        permissions: role === "admin" || roleId != null ? undefined : permissions,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      usersApi.update(initial!.id, {
        full_name: fullName || undefined,
        role,
        role_id: role === "admin" ? null : roleId,
        is_active: isActive,
        password: password || undefined,
        permissions: role === "admin" || roleId != null ? undefined : permissions,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  function handleRoleIdChange(value: string) {
    if (value === "") {
      setRoleId(null);
      return;
    }
    const id = Number(value);
    setRoleId(id);
    const selected = roles.find((r) => r.id === id);
    if (selected) {
      setPermissions(
        Object.fromEntries(formKeys.map((k) => [k, selected.permissions[k] || "none"])) as Record<string, PermissionLevel>
      );
    }
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
          <Label>{t("users.systemRole")}</Label>
          <Select
            value={role}
            onChange={(e) => {
              const next = e.target.value as UserRole;
              setRole(next);
              if (next === "admin") setRoleId(null);
            }}
          >
            <option value="admin">{t("enums.role.admin")}</option>
            <option value="user">{t("enums.role.user")}</option>
            <option value="visitor">{t("enums.role.visitor")}</option>
          </Select>
        </div>
        {role !== "admin" && (
          <div className="sm:col-span-2">
            <Label>{t("users.appRole")}</Label>
            <Select value={roleId == null ? "" : String(roleId)} onChange={(e) => handleRoleIdChange(e.target.value)}>
              <option value="">{t("users.customPermissions")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                  {r.description ? ` — ${r.description}` : ""}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-[11px] text-[var(--win-muted)]">{t("users.appRoleHint")}</p>
          </div>
        )}
        <div className="flex items-center gap-2 pt-6">
          <input id="is_active" type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          <Label htmlFor="is_active" className="mb-0">
            {t("users.active")}
          </Label>
        </div>
      </div>

      {role !== "admin" && !usingAppRole && (
        <PermissionMatrix formKeys={formKeys} permissions={permissions} onChange={setPermissions} />
      )}

      {usingAppRole && (
        <p className="rounded border border-[var(--win-border-shadow)] bg-[var(--win-panel)] px-3 py-2 text-xs text-[var(--win-muted)]">
          {t("users.roleMatrixLocked")}
        </p>
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

function RoleForm({
  formKeys,
  initial,
  onCancel,
  onSaved,
}: {
  formKeys: string[];
  initial: AppRole | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [permissions, setPermissions] = useState<Record<string, PermissionLevel>>(
    () => Object.fromEntries(formKeys.map((k) => [k, initial?.permissions?.[k] || "none"])) as Record<string, PermissionLevel>
  );
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () => rolesApi.create({ name, description: description || null, permissions }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      rolesApi.update(initial!.id, {
        name: initial?.is_system ? undefined : name,
        description: description || null,
        permissions,
      }),
    onSuccess: onSaved,
    onError: (e: Error) => setError(e.message),
  });

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
          <Label>{t("users.roleName")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} required disabled={!!initial?.is_system} />
        </div>
        <div>
          <Label>{t("users.roleDescription")}</Label>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>

      <PermissionMatrix formKeys={formKeys} permissions={permissions} onChange={setPermissions} />

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
