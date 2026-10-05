"use client";

import { useState } from "react";
import { authApi, usersApi } from "@/lib/endpoints";
import { isPasswordStrong, passwordRules } from "@/lib/password-policy";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";

export function PasswordRulesList({ password, username }: { password: string; username?: string | null }) {
  const { t } = useI18n();
  const rules = passwordRules(password, username);
  return (
    <ul className="mt-1 space-y-0.5 text-[11px]">
      {rules.map((rule) => (
        <li key={rule.id} className={rule.ok ? "text-emerald-700" : "text-[var(--win-muted)]"}>
          {rule.ok ? "✓" : "○"} {t(rule.labelKey)}
        </li>
      ))}
    </ul>
  );
}

/** Current user changes their own password (requires current password). */
export function ChangeOwnPasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNote(null);
    if (newPassword !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (!isPasswordStrong(newPassword, user?.username)) {
      setError(t("auth.passwordPolicyFailed"));
      return;
    }
    setBusy(true);
    try {
      await authApi.changePassword(currentPassword, newPassword);
      setNote(t("auth.passwordChanged"));
      setCurrentPassword("");
      setNewPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.passwordChangeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("auth.changePassword")}>
      <form onSubmit={submit} className="space-y-3">
        <div>
          <Label>{t("auth.currentPassword")}</Label>
          <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required autoComplete="current-password" />
        </div>
        <div>
          <Label>{t("auth.newPassword")}</Label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
          <PasswordRulesList password={newPassword} username={user?.username} />
        </div>
        <div>
          <Label>{t("auth.confirmPassword")}</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {error ? <p className="text-[12px] text-[var(--win-danger)]">{error}</p> : null}
        {note ? <p className="text-[12px] text-emerald-700">{note}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("auth.changePassword")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Admin sets / resets another local user's password. */
export function AdminSetPasswordDialog({
  open,
  userId,
  username,
  onClose,
  onSaved,
}: {
  open: boolean;
  userId: number;
  username: string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirm) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (!isPasswordStrong(newPassword, username)) {
      setError(t("auth.passwordPolicyFailed"));
      return;
    }
    setBusy(true);
    try {
      await usersApi.setPassword(userId, newPassword);
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("auth.passwordChangeFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={t("users.setPasswordTitle", { name: username })}>
      <form onSubmit={submit} className="space-y-3">
        <p className="text-[11px] text-[var(--win-muted)]">{t("users.setPasswordHelp")}</p>
        <div>
          <Label>{t("auth.newPassword")}</Label>
          <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required autoComplete="new-password" />
          <PasswordRulesList password={newPassword} username={username} />
        </div>
        <div>
          <Label>{t("auth.confirmPassword")}</Label>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
        </div>
        {error ? <p className="text-[12px] text-[var(--win-danger)]">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? t("common.saving") : t("users.setPassword")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
