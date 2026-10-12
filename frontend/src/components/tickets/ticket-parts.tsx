"use client";

import { useRef, useState } from "react";
import { Download, FileText, Image as ImageIcon, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { useI18n } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";
import { TICKET_FORMS, ticketsApi, type ComposePayload, type TicketFile, type TicketPriority, type TicketStatus } from "@/lib/tickets";

const ROLE_TONES = ["blue", "violet", "teal", "amber", "green", "red"] as const;

function roleTone(role: string): (typeof ROLE_TONES)[number] {
  let h = 0;
  for (const ch of role) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ROLE_TONES[h % ROLE_TONES.length];
}

/** Role of a person, coloured the same way everywhere so "who wrote this" is clear at a glance. */
export function RoleBadge({ role }: { role: string | null | undefined }) {
  if (!role) return null;
  return <span className={cn("ed-badge", `ed-tone-${roleTone(role)}`)}>{role}</span>;
}

const STATUS_TONE: Record<TicketStatus, string> = { open: "blue", in_progress: "amber", answered: "green", closed: "slate" };
const PRIORITY_TONE: Record<TicketPriority, string> = { low: "slate", normal: "blue", high: "amber", urgent: "red" };

export function StatusBadge({ status }: { status: TicketStatus }) {
  const { t } = useI18n();
  return <span className={cn("ed-badge", `ed-tone-${STATUS_TONE[status]}`)}>{t(`tickets.status.${status}`)}</span>;
}

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  const { t } = useI18n();
  if (priority === "normal") return null;
  return <span className={cn("ed-badge", `ed-tone-${PRIORITY_TONE[priority]}`)}>{t(`tickets.priority.${priority}`)}</span>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** A form sent inside a message, shown as a small table. */
export function FormView({ type, data }: { type: string; data: Record<string, string> }) {
  const { t } = useI18n();
  const known = TICKET_FORMS[type];
  const order = known ? known.fields.map((f) => f.key) : Object.keys(data);
  const keys = [...order.filter((k) => data[k]), ...Object.keys(data).filter((k) => !order.includes(k))];
  return (
    <div className="tk-form-view">
      <div className="tk-form-title">
        <FileText size={14} /> {t(`tickets.form.${type}.title`)}
      </div>
      <table>
        <tbody>
          {keys.map((k) => (
            <tr key={k}>
              <th>{t(`tickets.form.field.${k}`)}</th>
              <td>{known?.fields.find((f) => f.key === k)?.type === "select" ? t(`tickets.form.option.${data[k]}`) : data[k]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A file attached to a message; opens through an authenticated download. */
export function FileChip({ ticketId, file }: { ticketId: number; file: TicketFile }) {
  const [busy, setBusy] = useState(false);
  const isImage = file.content_type.startsWith("image/");
  async function open() {
    setBusy(true);
    try {
      const blob = await ticketsApi.file(ticketId, file.id);
      const url = URL.createObjectURL(blob);
      if (file.content_type === "application/pdf" || isImage) {
        window.open(url, "_blank", "noopener");
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        a.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className="tk-file" onClick={open} disabled={busy} title={file.name}>
      {isImage ? <ImageIcon size={14} /> : <Download size={14} />}
      <span className="tk-file-name">{file.name}</span>
      <span className="tk-file-size">{formatSize(file.size)}</span>
    </button>
  );
}

/** Fields of the chosen form template. */
function FormFields({ type, value, onChange }: { type: string; value: Record<string, string>; onChange: (next: Record<string, string>) => void }) {
  const { t } = useI18n();
  const tpl = TICKET_FORMS[type];
  if (!tpl) return null;
  return (
    <div className="tk-form-fields">
      {tpl.fields.map((f) => {
        const label = t(`tickets.form.field.${f.key}`);
        const set = (v: string) => onChange({ ...value, [f.key]: v });
        return (
          <label key={f.key} className={cn("tk-field", f.type === "textarea" && "is-wide")}>
            <span>{label}</span>
            {f.type === "textarea" ? (
              <Textarea rows={3} value={value[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
            ) : f.type === "select" ? (
              <Select value={value[f.key] ?? ""} onChange={(e) => set(e.target.value)}>
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o} value={o}>
                    {t(`tickets.form.option.${o}`)}
                  </option>
                ))}
              </Select>
            ) : (
              <Input type={f.type === "date" ? "date" : "text"} value={value[f.key] ?? ""} onChange={(e) => set(e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Message box with files and an optional form; used for a new ticket and for replies. */
export function Composer({
  onSend,
  sending,
  label,
  rows = 4,
  placeholder,
}: {
  onSend: (payload: ComposePayload) => void | Promise<void>;
  sending: boolean;
  label: string;
  rows?: number;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [formType, setFormType] = useState("");
  const [formData, setFormData] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);
  const filled = Object.values(formData).some((v) => v.trim());
  const canSend = !sending && Boolean(body.trim() || files.length > 0 || (formType && filled));

  async function send() {
    try {
      await onSend({ body, files, formType: formType && filled ? formType : null, formData: formType && filled ? formData : null });
    } catch {
      return; // the caller shows the error; keep what was typed
    }
    setBody("");
    setFiles([]);
    setFormType("");
    setFormData({});
  }

  return (
    <div className="tk-composer">
      <Textarea
        rows={rows}
        value={body}
        placeholder={placeholder ?? t("tickets.writeMessage")}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && canSend) void send();
        }}
      />
      {formType ? (
        <div className="tk-form-box">
          <div className="tk-form-box-head">
            <strong>{t(`tickets.form.${formType}.title`)}</strong>
            <button
              type="button"
              className="tk-icon-btn"
              onClick={() => {
                setFormType("");
                setFormData({});
              }}
              aria-label={t("tickets.removeForm")}
              title={t("tickets.removeForm")}
            >
              <X size={14} />
            </button>
          </div>
          <FormFields type={formType} value={formData} onChange={setFormData} />
        </div>
      ) : null}
      {files.length ? (
        <div className="tk-files">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="tk-file is-pending">
              <Paperclip size={13} />
              <span className="tk-file-name">{f.name}</span>
              <span className="tk-file-size">{formatSize(f.size)}</span>
              <button type="button" className="tk-icon-btn" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={t("common.delete")}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="tk-composer-bar">
        <input
          ref={input}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setFiles((prev) => [...prev, ...picked].slice(0, 10));
            e.target.value = "";
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={() => input.current?.click()}>
          <Paperclip size={14} /> {t("tickets.attach")}
        </Button>
        <Select
          className="tk-form-select"
          value={formType}
          onChange={(e) => {
            setFormType(e.target.value);
            setFormData({});
          }}
          aria-label={t("tickets.attachForm")}
        >
          <option value="">{t("tickets.attachForm")}</option>
          {Object.keys(TICKET_FORMS).map((k) => (
            <option key={k} value={k}>
              {t(`tickets.form.${k}.title`)}
            </option>
          ))}
        </Select>
        <span className="tk-hint">{t("tickets.sendHint")}</span>
        <Button type="button" onClick={() => void send()} disabled={!canSend} className="ms-auto">
          <Send size={14} /> {sending ? t("common.saving") : label}
        </Button>
      </div>
    </div>
  );
}
