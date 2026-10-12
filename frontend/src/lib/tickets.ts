import { apiClient } from "./api-client";

export type TicketStatus = "open" | "in_progress" | "answered" | "closed";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketCategory = "general" | "request" | "issue" | "form" | "info";
export type TicketBox = "inbox" | "sent" | "unread" | "open" | "closed" | "all" | "everything";

export const TICKET_STATUSES: TicketStatus[] = ["open", "in_progress", "answered", "closed"];
export const TICKET_PRIORITIES: TicketPriority[] = ["low", "normal", "high", "urgent"];
export const TICKET_CATEGORIES: TicketCategory[] = ["general", "request", "issue", "form", "info"];

export interface TicketSummary {
  id: number;
  subject: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  created_by_id: number | null;
  created_by_name: string | null;
  created_by_role: string | null;
  created_at: string | null;
  last_message_at: string | null;
  to_all: boolean;
  unread: number;
  messages: number;
  participants: number;
  people: string[];
  last_sender: string | null;
  last_role: string | null;
  last_preview: string | null;
  mine: boolean;
}

export interface TicketFile {
  id: number;
  name: string;
  size: number;
  content_type: string;
}

export interface TicketThreadMessage {
  id: number;
  kind: "message" | "system";
  sender_id: number | null;
  sender_name: string | null;
  sender_role: string | null;
  body: string | null;
  form_type: string | null;
  form_data: Record<string, string> | null;
  created_at: string | null;
  files: TicketFile[];
}

export interface TicketPerson {
  id: number;
  name: string;
  username: string;
  role: string;
  via: string | null;
}

export interface TicketDetail extends TicketSummary {
  closed_at: string | null;
  people_detail: TicketPerson[];
  thread: TicketThreadMessage[];
  is_participant: boolean;
}

export interface TicketDirectory {
  users: { id: number; username: string; name: string; role: string }[];
  roles: { key: string; name: string; users: number }[];
  everyone: number;
}

export interface TicketNotice {
  id: number;
  ticket_id: number;
  kind: "new_ticket" | "message" | "status" | "added";
  from_name: string | null;
  from_role: string | null;
  subject: string | null;
  preview: string | null;
  created_at: string | null;
  read: boolean;
}

/** Forms a person can attach to a message. Field labels live in the translations (tickets.form.*). */
export const TICKET_FORMS: Record<string, { fields: { key: string; type: "text" | "textarea" | "date" | "select"; options?: string[] }[] }> = {
  element_request: {
    fields: [
      { key: "element_nr", type: "text" },
      { key: "electrolyzer", type: "text" },
      { key: "position", type: "text" },
      { key: "action", type: "select", options: ["inspect", "replace", "disassemble", "assemble", "other"] },
      { key: "reason", type: "textarea" },
    ],
  },
  maintenance_request: {
    fields: [
      { key: "component", type: "select", options: ["anode", "cathode", "membrane", "other"] },
      { key: "component_nr", type: "text" },
      { key: "work_needed", type: "textarea" },
      { key: "needed_by", type: "date" },
    ],
  },
  material_request: {
    fields: [
      { key: "item", type: "text" },
      { key: "quantity", type: "text" },
      { key: "needed_by", type: "date" },
      { key: "purpose", type: "textarea" },
    ],
  },
  incident_report: {
    fields: [
      { key: "date", type: "date" },
      { key: "place", type: "text" },
      { key: "description", type: "textarea" },
      { key: "immediate_action", type: "textarea" },
    ],
  },
  general_form: {
    fields: [
      { key: "title", type: "text" },
      { key: "details", type: "textarea" },
    ],
  },
};

export interface ComposePayload {
  body: string;
  files: File[];
  formType?: string | null;
  formData?: Record<string, string> | null;
}

function toForm(payload: ComposePayload, extra: Record<string, string | undefined> = {}): FormData {
  const form = new FormData();
  form.append("body", payload.body);
  if (payload.formType && payload.formData) {
    form.append("form_type", payload.formType);
    form.append("form_data", JSON.stringify(payload.formData));
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) form.append(k, v);
  for (const file of payload.files) form.append("files", file);
  return form;
}

export const ticketsApi = {
  directory: async (): Promise<TicketDirectory> => (await apiClient.get("/tickets/directory")).data,
  unread: async (): Promise<{ notifications: number; tickets: number }> => (await apiClient.get("/tickets/unread")).data,
  notifications: async (params: { only_unread?: boolean; limit?: number } = {}): Promise<{ unread: number; items: TicketNotice[] }> =>
    (await apiClient.get("/tickets/notifications", { params })).data,
  markRead: async (body: { ids?: number[]; ticket_id?: number; all?: boolean }): Promise<{ marked: number }> =>
    (await apiClient.post("/tickets/notifications/read", body)).data,
  list: async (box: TicketBox, q?: string): Promise<TicketSummary[]> =>
    (await apiClient.get("/tickets", { params: { box, q: q || undefined } })).data,
  get: async (id: number): Promise<TicketDetail> => (await apiClient.get(`/tickets/${id}`)).data,
  create: async (
    payload: ComposePayload & {
      subject: string;
      category: TicketCategory;
      priority: TicketPriority;
      users: number[];
      roles: string[];
      toAll: boolean;
    }
  ): Promise<{ id: number; recipients: number }> => {
    const form = toForm(payload, {
      subject: payload.subject,
      category: payload.category,
      priority: payload.priority,
      recipient_users: JSON.stringify(payload.users),
      recipient_roles: JSON.stringify(payload.roles),
      to_all: payload.toAll ? "true" : "false",
    });
    return (await apiClient.post("/tickets", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
  },
  reply: async (id: number, payload: ComposePayload): Promise<{ id: number; status: TicketStatus }> =>
    (await apiClient.post(`/tickets/${id}/messages`, toForm(payload), { headers: { "Content-Type": "multipart/form-data" } })).data,
  update: async (id: number, body: { status?: TicketStatus; priority?: TicketPriority }) => (await apiClient.patch(`/tickets/${id}`, body)).data,
  addPeople: async (id: number, body: { users: number[]; roles: string[]; everyone: boolean }): Promise<{ added: number }> =>
    (await apiClient.post(`/tickets/${id}/participants`, body)).data,
  file: async (ticketId: number, fileId: number): Promise<Blob> =>
    (await apiClient.get(`/tickets/${ticketId}/files/${fileId}`, { responseType: "blob" })).data,
  remove: async (id: number): Promise<void> => {
    await apiClient.delete(`/tickets/${id}`);
  },
};
