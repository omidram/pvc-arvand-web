"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox, MessageSquarePlus, Search, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { ErrorState, LoadingState } from "@/components/ui/spinner";
import { useAuth } from "@/lib/auth/context";
import { useI18n } from "@/lib/i18n/context";
import { cn, formatDateTime } from "@/lib/utils";
import {
  TICKET_CATEGORIES,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  ticketsApi,
  type TicketBox,
  type TicketCategory,
  type TicketDetail,
  type TicketDirectory,
  type TicketPriority,
  type TicketStatus,
  type TicketSummary,
  type TicketThreadMessage,
} from "@/lib/tickets";
import { Composer, FileChip, FormView, PriorityBadge, RoleBadge, StatusBadge } from "@/components/tickets/ticket-parts";

interface Picks {
  users: number[];
  roles: string[];
  all: boolean;
}

const EMPTY_PICKS: Picks = { users: [], roles: [], all: false };

/** Who to send to: everybody, a whole role, or single users. */
function RecipientPicker({ directory, picks, onChange }: { directory: TicketDirectory; picks: Picks; onChange: (next: Picks) => void }) {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const users = directory.users.filter((u) => !needle || `${u.name} ${u.username} ${u.role}`.toLowerCase().includes(needle));
  const toggle = <K extends "users" | "roles">(key: K, value: Picks[K][number]) => {
    const list = picks[key] as (typeof value)[];
    onChange({ ...picks, [key]: list.includes(value) ? list.filter((x) => x !== value) : [...list, value] });
  };
  const total = picks.all ? directory.everyone : picks.users.length + picks.roles.length;
  return (
    <div className="tk-picker">
      <div className="tk-picker-top">
        <label className={cn("tk-chip", picks.all && "is-on")}>
          <input type="checkbox" checked={picks.all} onChange={(e) => onChange({ ...EMPTY_PICKS, all: e.target.checked })} />
          <Users size={14} /> {t("tickets.everyone", { count: directory.everyone })}
        </label>
        {!picks.all
          ? directory.roles.map((r) => (
              <label key={r.key} className={cn("tk-chip", picks.roles.includes(r.key) && "is-on")}>
                <input type="checkbox" checked={picks.roles.includes(r.key)} onChange={() => toggle("roles", r.key)} />
                {t("tickets.roleGroup", { name: r.name, count: r.users })}
              </label>
            ))
          : null}
      </div>
      {!picks.all ? (
        <>
          <div className="tk-search">
            <Search size={14} />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("tickets.searchPeople")} />
          </div>
          <div className="tk-people">
            {users.length === 0 ? <p className="tk-empty">{t("tickets.noPeople")}</p> : null}
            {users.map((u) => (
              <label key={u.id} className={cn("tk-person", picks.users.includes(u.id) && "is-on")}>
                <input type="checkbox" checked={picks.users.includes(u.id)} onChange={() => toggle("users", u.id)} />
                <span className="tk-person-name">{u.name}</span>
                <span className="tk-person-user">{u.username}</span>
                <RoleBadge role={u.role} />
              </label>
            ))}
          </div>
        </>
      ) : null}
      <div className="tk-hint">{t("tickets.recipientsCount", { count: total })}</div>
    </div>
  );
}

function NewTicketModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: number) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const directory = useQuery({ queryKey: ["tickets", "directory"], queryFn: ticketsApi.directory });
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [picks, setPicks] = useState<Picks>(EMPTY_PICKS);
  const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: (payload: Parameters<typeof ticketsApi.create>[0]) => ticketsApi.create(payload),
    onSuccess: (res) => {
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      onCreated(res.id);
    },
  });
  const noRecipients = !picks.all && picks.users.length === 0 && picks.roles.length === 0;

  return (
    <Modal open onClose={onClose} title={t("tickets.new")} wide>
      <div className="tk-new">
        <div className="tk-new-left">
          <Label>{t("tickets.to")}</Label>
          {directory.isLoading ? <LoadingState /> : null}
          {directory.data ? <RecipientPicker directory={directory.data} picks={picks} onChange={setPicks} /> : null}
          {directory.isError ? <ErrorState message={(directory.error as Error).message} /> : null}
        </div>
        <div className="tk-new-right">
          <div className="tk-new-row">
            <div className="tk-new-grow">
              <Label>{t("tickets.subject")}</Label>
              <Input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} placeholder={t("tickets.subjectHint")} />
            </div>
            <div>
              <Label>{t("tickets.categoryLabel")}</Label>
              <Select value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)}>
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`tickets.category.${c}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>{t("tickets.priorityLabel")}</Label>
              <Select value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`tickets.priority.${p}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          {error ? <ErrorState message={error} /> : null}
          {noRecipients ? <p className="tk-hint is-warn">{t("tickets.pickRecipients")}</p> : null}
          <Composer
            rows={7}
            label={t("tickets.send")}
            sending={create.isPending}
            onSend={async (payload) => {
              setError(null);
              if (!subject.trim()) {
                setError(t("tickets.subjectRequired"));
                throw new Error("subject");
              }
              if (noRecipients) {
                setError(t("tickets.pickRecipients"));
                throw new Error("recipients");
              }
              try {
                await create.mutateAsync({ ...payload, subject: subject.trim(), category, priority, users: picks.users, roles: picks.roles, toAll: picks.all });
              } catch (e) {
                setError((e as Error).message);
                throw e;
              }
            }}
          />
        </div>
      </div>
    </Modal>
  );
}

function AddPeopleModal({ ticket, onClose }: { ticket: TicketDetail; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const directory = useQuery({ queryKey: ["tickets", "directory"], queryFn: ticketsApi.directory });
  const [picks, setPicks] = useState<Picks>(EMPTY_PICKS);
  const have = new Set(ticket.people_detail.map((p) => p.id));
  const filtered: TicketDirectory | undefined = directory.data ? { ...directory.data, users: directory.data.users.filter((u) => !have.has(u.id)) } : undefined;
  const add = useMutation({
    mutationFn: () => ticketsApi.addPeople(ticket.id, { users: picks.users, roles: picks.roles, everyone: picks.all }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["tickets"] });
      onClose();
    },
  });
  return (
    <Modal open onClose={onClose} title={t("tickets.addPeople")}>
      {filtered ? <RecipientPicker directory={filtered} picks={picks} onChange={setPicks} /> : <LoadingState />}
      {add.isError ? <ErrorState message={(add.error as Error).message} /> : null}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t("common.close")}
        </Button>
        <Button disabled={add.isPending || (!picks.all && !picks.users.length && !picks.roles.length)} onClick={() => add.mutate()}>
          {t("tickets.add")}
        </Button>
      </div>
    </Modal>
  );
}

function SystemLine({ m }: { m: TicketThreadMessage }) {
  const { t } = useI18n();
  const body = m.body ?? "";
  let text = body;
  if (body.startsWith("status:")) text = t("tickets.sys.status", { name: m.sender_name, status: t(`tickets.status.${body.slice(7)}`) });
  else if (body.startsWith("priority:")) text = t("tickets.sys.priority", { name: m.sender_name, priority: t(`tickets.priority.${body.slice(9)}`) });
  else if (body.startsWith("added:")) text = t("tickets.sys.added", { name: m.sender_name, names: body.slice(6) });
  else if (body.includes("status:") || body.includes("priority:")) {
    text = body
      .split(" ")
      .map((part) => (part.startsWith("status:") ? t(`tickets.status.${part.slice(7)}`) : part.startsWith("priority:") ? t(`tickets.priority.${part.slice(9)}`) : part))
      .join(" · ");
    text = `${m.sender_name}: ${text}`;
  }
  return (
    <div className="tk-system">
      <span>{text}</span>
      <time>{formatDateTime(m.created_at)}</time>
    </div>
  );
}

function Thread({ id, onDeleted }: { id: number; onDeleted: () => void }) {
  const { t } = useI18n();
  const { user, isAdmin } = useAuth();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const query = useQuery({ queryKey: ["tickets", "detail", id], queryFn: () => ticketsApi.get(id), refetchInterval: 8000 });
  const data = query.data;

  const refresh = () => qc.invalidateQueries({ queryKey: ["tickets"] });
  const reply = useMutation({ mutationFn: (p: Parameters<typeof ticketsApi.reply>[1]) => ticketsApi.reply(id, p), onSuccess: () => void refresh() });
  const update = useMutation({
    mutationFn: (body: { status?: TicketStatus; priority?: TicketPriority }) => ticketsApi.update(id, body),
    onSuccess: () => void refresh(),
  });
  const remove = useMutation({
    mutationFn: () => ticketsApi.remove(id),
    onSuccess: () => {
      void refresh();
      onDeleted();
    },
  });

  const count = data?.thread.length ?? 0;
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [count, id]);

  if (query.isLoading) return <LoadingState />;
  if (query.isError || !data) return <ErrorState message={(query.error as Error)?.message || "Error"} />;

  return (
    <div className="tk-thread">
      <header className="tk-thread-head">
        <div className="tk-thread-title">
          <h3>{data.subject}</h3>
          <div className="tk-thread-badges">
            <StatusBadge status={data.status} />
            <PriorityBadge priority={data.priority} />
            <span className="ed-badge ed-tone-slate">{t(`tickets.category.${data.category}`)}</span>
            <span className="tk-meta">
              #{data.id} · {t("tickets.startedBy", { name: data.created_by_name })} <RoleBadge role={data.created_by_role} /> · {formatDateTime(data.created_at)}
            </span>
          </div>
        </div>
        <div className="tk-thread-actions">
          {data.is_participant ? (
            <>
              <Select value={data.status} onChange={(e) => update.mutate({ status: e.target.value as TicketStatus })} aria-label={t("tickets.statusLabel")}>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {t(`tickets.status.${s}`)}
                  </option>
                ))}
              </Select>
              <Select value={data.priority} onChange={(e) => update.mutate({ priority: e.target.value as TicketPriority })} aria-label={t("tickets.priorityLabel")}>
                {TICKET_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`tickets.priority.${p}`)}
                  </option>
                ))}
              </Select>
              <Button size="sm" variant="secondary" onClick={() => setAddOpen(true)}>
                <UserPlus size={14} /> {t("tickets.addPeople")}
              </Button>
            </>
          ) : null}
          {isAdmin ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                if (window.confirm(t("tickets.confirmDelete", { subject: data.subject }))) remove.mutate();
              }}
            >
              <Trash2 size={14} />
            </Button>
          ) : null}
        </div>
      </header>

      <div className="tk-people-line">
        <Users size={14} />
        {data.people_detail.map((p) => (
          <span key={p.id} className="tk-who" title={p.username}>
            {p.name} <RoleBadge role={p.role} />
          </span>
        ))}
      </div>

      <div className="tk-messages">
        {data.thread.map((m) =>
          m.kind === "system" ? (
            <SystemLine key={m.id} m={m} />
          ) : (
            <article key={m.id} className={cn("tk-msg", m.sender_id === user?.id && "is-mine")}>
              <div className="tk-msg-head">
                <strong>{m.sender_name}</strong>
                <RoleBadge role={m.sender_role} />
                <time>{formatDateTime(m.created_at)}</time>
              </div>
              {m.body ? <div className="tk-msg-body">{m.body}</div> : null}
              {m.form_type && m.form_data ? <FormView type={m.form_type} data={m.form_data} /> : null}
              {m.files.length ? (
                <div className="tk-files">
                  {m.files.map((f) => (
                    <FileChip key={f.id} ticketId={data.id} file={f} />
                  ))}
                </div>
              ) : null}
            </article>
          )
        )}
        <div ref={bottom} />
      </div>

      {data.is_participant ? (
        <div className="tk-reply">
          {error ? <ErrorState message={error} /> : null}
          {data.status === "closed" ? <p className="tk-hint is-warn">{t("tickets.closedHint")}</p> : null}
          <Composer
            rows={3}
            label={t("tickets.reply")}
            sending={reply.isPending}
            onSend={async (payload) => {
              setError(null);
              try {
                await reply.mutateAsync(payload);
              } catch (e) {
                setError((e as Error).message);
                throw e;
              }
            }}
          />
        </div>
      ) : (
        <p className="tk-hint is-warn tk-reply">{t("tickets.readOnlyAdmin")}</p>
      )}
      {addOpen ? <AddPeopleModal ticket={data} onClose={() => setAddOpen(false)} /> : null}
    </div>
  );
}

function ListItem({ ticket, active, onSelect }: { ticket: TicketSummary; active: boolean; onSelect: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className={cn("tk-item", active && "is-active", ticket.unread > 0 && "is-unread")} onClick={onSelect}>
      <span className="tk-item-top">
        <span className="tk-item-subject">{ticket.subject}</span>
        {ticket.unread > 0 ? <span className="tk-dot">{ticket.unread}</span> : null}
      </span>
      <span className="tk-item-line">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <span className="tk-item-from">
          {ticket.last_sender ?? ticket.created_by_name} {ticket.last_role ? <RoleBadge role={ticket.last_role} /> : null}
        </span>
      </span>
      {ticket.last_preview ? <span className="tk-item-preview">{ticket.last_preview}</span> : null}
      <span className="tk-item-meta">
        {t("tickets.participantsCount", { count: ticket.participants })} · {formatDateTime(ticket.last_message_at)}
      </span>
    </button>
  );
}

/** Tickets for everybody: write to people or roles, attach files and forms, and get told when an answer arrives. */
export function TicketsPanel() {
  const { t } = useI18n();
  const { isAdmin } = useAuth();
  const params = useSearchParams();
  const [box, setBox] = useState<TicketBox>("inbox");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const fromUrl = Number(params.get("ticket")) || null;
  // A click picks a ticket; a new ?ticket= link (from the bell) wins again once the URL changes.
  const [picked, setPicked] = useState<{ id: number | null; url: number | null } | null>(null);
  const selected = picked && picked.url === fromUrl ? picked.id : fromUrl;
  const setSelected = (id: number | null) => setPicked({ id, url: fromUrl });

  const list = useQuery({
    queryKey: ["tickets", "list", box, search],
    queryFn: () => ticketsApi.list(box, search.trim() || undefined),
    refetchInterval: 15_000,
  });
  const unread = useQuery({ queryKey: ["tickets", "unread"], queryFn: ticketsApi.unread, refetchInterval: 10_000 });

  const boxes: { key: TicketBox; label: string; count?: number }[] = useMemo(
    () => [
      { key: "inbox", label: t("tickets.box.inbox"), count: unread.data?.tickets || undefined },
      { key: "unread", label: t("tickets.box.unread") },
      { key: "sent", label: t("tickets.box.sent") },
      { key: "open", label: t("tickets.box.open") },
      { key: "closed", label: t("tickets.box.closed") },
      ...(isAdmin ? [{ key: "everything" as TicketBox, label: t("tickets.box.everything") }] : []),
    ],
    [t, unread.data?.tickets, isAdmin]
  );

  return (
    <div className="tk-page">
      <aside className="tk-side">
        <div className="tk-side-top">
          <Button onClick={() => setComposeOpen(true)}>
            <MessageSquarePlus size={15} /> {t("tickets.new")}
          </Button>
          <div className="tk-search">
            <Search size={14} />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("tickets.search")} />
          </div>
          <div className="tk-boxes">
            {boxes.map((b) => (
              <button key={b.key} type="button" className={cn("mon-filter-chip", box === b.key && "is-active")} onClick={() => setBox(b.key)}>
                {b.label}
                {b.count ? <span className="tk-box-count">{b.count}</span> : null}
              </button>
            ))}
          </div>
        </div>
        <div className="tk-list">
          {list.isLoading ? <LoadingState /> : null}
          {list.isError ? <ErrorState message={(list.error as Error).message} /> : null}
          {list.data && list.data.length === 0 ? (
            <div className="tk-empty">
              <Inbox size={28} />
              <p>{t("tickets.empty")}</p>
            </div>
          ) : null}
          {list.data?.map((ticket) => (
            <ListItem key={ticket.id} ticket={ticket} active={selected === ticket.id} onSelect={() => setSelected(ticket.id)} />
          ))}
        </div>
      </aside>

      <section className="tk-main">
        {selected ? (
          <Thread key={selected} id={selected} onDeleted={() => setSelected(null)} />
        ) : (
          <div className="tk-empty is-big">
            <MessageSquarePlus size={40} />
            <h3>{t("tickets.pickOne")}</h3>
            <p>{t("tickets.intro")}</p>
          </div>
        )}
      </section>

      {composeOpen ? (
        <NewTicketModal
          onClose={() => setComposeOpen(false)}
          onCreated={(id) => {
            setComposeOpen(false);
            setBox("sent");
            setSelected(id);
          }}
        />
      ) : null}
    </div>
  );
}
