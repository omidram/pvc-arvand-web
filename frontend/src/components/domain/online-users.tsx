"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { authApi, usersApi } from "@/lib/endpoints";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/** Keeps the signed-in account visible to the administrator while the program is open. */
export function OnlinePresence() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    const ping = () => {
      void authApi.ping().catch(() => undefined);
    };
    const id = window.setInterval(ping, 45_000);
    return () => window.clearInterval(id);
  }, [user]);
  return null;
}

export function OnlineUsersButton({ classic }: { classic?: boolean }) {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const query = useQuery({
    queryKey: ["users", "online"],
    queryFn: usersApi.online,
    enabled: isAdmin,
    refetchInterval: 20_000,
  });
  if (!isAdmin) return null;
  const count = query.data?.length;
  const btn = classic
    ? "h-[22px] border-2 border-white bg-white px-2 text-[11px] text-black [border-style:outset] hover:bg-[#ffffe8] active:[border-style:inset]"
    : "access-toolbar-btn";
  return (
    <span className="relative">
      <button type="button" className={cn(btn, "inline-flex items-center gap-1")} title={t("users.onlineButton")} onClick={() => setOpen((v) => !v)}>
        <Users size={12} />
        {count != null ? count : t("users.onlineNow")}
      </button>
      {open ? (
        <div className="online-users-pop">
          <strong>{t("users.onlineNow")}</strong>
          {query.isLoading ? <p>…</p> : null}
          {query.data && !query.data.length ? <p>{t("users.onlineEmpty")}</p> : null}
          <ul>
            {(query.data || []).map((row) => (
              <li key={row.id}>
                <b>{row.full_name || row.username}</b>
                <span>{row.role_name || row.username}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

export function OnlineUsersPanel() {
  const { t } = useI18n();
  const query = useQuery({ queryKey: ["users", "online"], queryFn: usersApi.online, refetchInterval: 20_000 });
  return (
    <section className="online-users-panel">
      <strong>
        {t("users.onlineNow")}
        {query.data ? ` (${query.data.length})` : ""}
      </strong>
      {query.data && !query.data.length ? <p>{t("users.onlineEmpty")}</p> : null}
      <ul>
        {(query.data || []).map((row) => (
          <li key={row.id}>
            <b>{row.full_name || row.username}</b>
            <span>{row.role_name || row.role}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
