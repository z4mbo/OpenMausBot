export const PIPELINE_STAGES = ["New", "Contacted", "Qualified", "Proposal", "Won", "Lost"] as const;
export const CLOSED_STAGES: readonly string[] = ["Won", "Lost"];
export const PIPELINE_IMPORT_MAX = 500;

export type PipelineActorKind = "member" | "agent" | "system";
export type PipelineActor = { kind: PipelineActorKind; name: string; id?: string };
export type PipelineChannel = "email" | "sms" | "whatsapp" | "call" | "ai_call";
export type PipelineActivityKind = PipelineChannel | "note" | "stage" | "capture" | "import";
/** received: the lead wrote or called in, through the project's Twilio or Brevo webhook. */
export type PipelineActivityStatus = "logged" | "pending" | "approved" | "sending" | "sent" | "in_progress" | "done" | "failed" | "discarded" | "received";

/** A lead as `pipeline:board` and `pipeline:lead` return it. `value` is in the project's currency; `nextDue` is YYYY-MM-DD. */
export interface PipelineLead {
  _id: string;
  projectId: string;
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source: string;
  stage: string;
  order: number;
  value?: number;
  owner?: PipelineActor;
  tags: string[];
  notes?: string;
  nextStep?: string;
  nextDue?: string;
  lastActivityAt?: number;
  /** Inbound messages nobody on the team has opened yet; opening the lead clears it. */
  unreadReplies?: number;
  lastReplyAt?: number;
  stageChangedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** One entry of a lead's timeline. `providerId` is the Brevo message, Twilio SID or ElevenLabs conversation id. */
export interface PipelineActivity {
  _id: string;
  leadId: string;
  kind: PipelineActivityKind;
  status: PipelineActivityStatus;
  actor: PipelineActor;
  subject?: string;
  body?: string;
  goal?: string;
  transcript?: string;
  summary?: string;
  providerId?: string;
  error?: string;
  approvedBy?: string;
  sequenceId?: string;
  createdAt: number;
  updatedAt: number;
}

/** Present for editors once inbound is on: the webhook addresses to paste into Twilio and Brevo. */
export interface PipelineInboundView {
  twilioUrl: string;
  brevoUrl: string;
  /** Brevo sends it as a Bearer token, or as the password of the address's credentials. */
  brevoSecret: string;
  /** Whether a Twilio auth token is stored to check X-Twilio-Signature; it is never sent back. */
  twilioSigning: boolean;
  replyToEmail?: string;
}

export interface PipelineSettingsView {
  configured: boolean;
  captureEnabled: boolean;
  /** Present for editors only: the public endpoint a landing page form posts to, its token included. */
  captureUrl?: string;
  autoSend: boolean;
  currency: string;
  aiAgentId?: string;
  aiPhoneNumberId?: string;
  inboundEnabled: boolean;
  inbound?: PipelineInboundView;
}

export type PipelineSequenceChannel = "email" | "sms" | "whatsapp" | "ai_call" | "call_task";
export type PipelineSequenceStatus = "active" | "paused" | "stopped" | "done";

/** One follow-up of a sequence: due `day` days after it starts; contact steps become drafts a person approves. */
export interface PipelineSequenceStep {
  day: number;
  channel: PipelineSequenceChannel;
  subject?: string;
  body?: string;
  goal?: string;
  state: "waiting" | "drafted" | "done" | "skipped";
  activityId?: string;
}

export interface PipelineSequence {
  _id: string;
  leadId: string;
  status: PipelineSequenceStatus;
  steps: PipelineSequenceStep[];
  startedAt: number;
  pausedAt?: number;
  nextDueAt?: number;
  createdBy: PipelineActor;
  stopReason?: string;
  updatedAt: number;
}

export const SEQUENCE_STEPS_MAX = 8;
export const SEQUENCE_DAYS_MAX = 90;

/** Fills {first_name}, {name} and {company} in a sequence step with the lead's own details. */
export function fillLeadTemplate(text: string, lead: { name: string; company?: string }): string {
  const first = lead.name.trim().split(/\s+/)[0] || lead.name;
  return text.replace(/\{first_name\}/g, first).replace(/\{name\}/g, lead.name).replace(/\{company\}/g, lead.company ?? "your team");
}

export interface PipelinePendingContact extends PipelineActivity {
  leadName: string;
}

export interface PipelineBoard {
  stages: string[];
  leads: PipelineLead[];
  settings: PipelineSettingsView;
  pending: PipelinePendingContact[];
}

export interface PipelineImportRow {
  name: string;
  company?: string;
  email?: string;
  phone?: string;
  source?: string;
  value?: number;
  tags?: string[];
  notes?: string;
  stage?: string;
}

export function normalizeLeadEmail(value: string | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  if (!email) return undefined;
  return /^[^\s@<>()",;]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(email) && email.length <= 254 ? email : undefined;
}

/** E.164-ish: a leading + and 6 to 15 digits; spaces, dots, dashes and brackets are dropped. */
export function normalizeLeadPhone(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  const digits = raw.replace(/[\s().-]/g, "");
  const phone = digits.startsWith("00") ? `+${digits.slice(2)}` : digits;
  return /^\+?\d{6,15}$/.test(phone) ? phone : undefined;
}

export function stageTotals(leads: readonly Pick<PipelineLead, "stage" | "value">[], stages: readonly string[]): Map<string, { count: number; value: number }> {
  const totals = new Map(stages.map((stage) => [stage, { count: 0, value: 0 }]));
  for (const lead of leads) {
    const total = totals.get(lead.stage);
    if (!total) continue;
    total.count += 1;
    total.value += lead.value ?? 0;
  }
  return totals;
}

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  const delimiter = (() => {
    const head = source.split(/\r?\n/, 1)[0] ?? "";
    const count = (mark: string) => head.split(mark).length;
    return count(";") > count(",") && count(";") > count("\t") ? ";" : count("\t") > count(",") ? "\t" : ",";
  })();
  for (let index = 0; index < source.length; index++) {
    const char = source[index]!;
    if (quoted) {
      if (char === "\"" && source[index + 1] === "\"") { cell += "\""; index++; }
      else if (char === "\"") quoted = false;
      else cell += char;
    } else if (char === "\"" && !cell) quoted = true;
    else if (char === delimiter) { row.push(cell); cell = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index++;
      row.push(cell); cell = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<keyof PipelineImportRow | "first" | "last", readonly string[]> = {
  name: ["name", "fullname", "contact", "contactname", "nome", "lead"],
  first: ["firstname", "first", "givenname"],
  last: ["lastname", "last", "surname", "familyname", "cognome"],
  company: ["company", "organization", "organisation", "account", "business", "azienda"],
  email: ["email", "emailaddress", "mail", "e-mail"],
  phone: ["phone", "phonenumber", "mobile", "tel", "telephone", "telefono", "cell"],
  source: ["source", "leadsource", "channel", "origin"],
  value: ["value", "dealvalue", "amount", "deal", "valore"],
  tags: ["tags", "labels", "tag"],
  notes: ["notes", "note", "description", "comments", "message"],
  stage: ["stage", "status", "pipeline", "dealstage"],
};

const headerKey = (value: string) => value.trim().toLowerCase().replace(/[\s_]+/g, "");

/** Reads a CSV export (comma, semicolon or tab separated, header row first) into lead rows; rows without a name, email or phone are skipped. */
export function parseLeadsCsv(text: string): { rows: PipelineImportRow[]; skipped: number } {
  const [header, ...body] = csvRows(text);
  if (!header) return { rows: [], skipped: 0 };
  const keys = header.map(headerKey);
  const column = (field: keyof typeof HEADER_ALIASES) => keys.findIndex((key) => HEADER_ALIASES[field].includes(key));
  const at = (cells: string[], field: keyof typeof HEADER_ALIASES) => {
    const index = column(field);
    return index >= 0 ? cells[index]?.trim() ?? "" : "";
  };
  const rows: PipelineImportRow[] = [];
  let skipped = 0;
  for (const cells of body) {
    const email = normalizeLeadEmail(at(cells, "email"));
    const phone = normalizeLeadPhone(at(cells, "phone"));
    const name = (at(cells, "name") || [at(cells, "first"), at(cells, "last")].filter(Boolean).join(" ") || email?.split("@")[0] || phone || "").slice(0, 200);
    if (!name || rows.length >= PIPELINE_IMPORT_MAX) { skipped++; continue; }
    const value = Number(at(cells, "value").replace(/[^\d.,-]/g, "").replace(/,(?=\d{3}\b)/g, "").replace(",", "."));
    const tags = at(cells, "tags").split(/[,;|]/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12);
    const optional = <K extends keyof PipelineImportRow>(key: K, value: PipelineImportRow[K] | "" | undefined) => (value === "" || value === undefined ? {} : { [key]: value });
    rows.push({
      name,
      ...optional("company", at(cells, "company").slice(0, 200)),
      ...optional("email", email),
      ...optional("phone", phone),
      ...optional("source", at(cells, "source").slice(0, 60)),
      ...(Number.isFinite(value) && value > 0 ? { value } : {}),
      ...(tags.length ? { tags } : {}),
      ...optional("notes", at(cells, "notes").slice(0, 4000)),
      ...optional("stage", at(cells, "stage").slice(0, 40)),
    });
  }
  return { rows, skipped };
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

/** A form a landing page can paste in; it posts to the project's capture endpoint without JavaScript. */
export function captureFormSnippet(captureUrl: string): string {
  return [
    `<form action="${escapeHtml(captureUrl)}" method="POST">`,
    `  <input name="name" placeholder="Your name" required>`,
    `  <input name="email" type="email" placeholder="Email" required>`,
    `  <input name="phone" type="tel" placeholder="Phone">`,
    `  <input name="company" placeholder="Company">`,
    `  <textarea name="message" placeholder="How can we help?"></textarea>`,
    `  <input name="website" tabindex="-1" autocomplete="off" style="display:none">`,
    `  <input type="hidden" name="redirect" value="">`,
    `  <button type="submit">Send</button>`,
    `</form>`,
  ].join("\n");
}

export function captureFetchSnippet(captureUrl: string): string {
  return [
    `await fetch(${JSON.stringify(captureUrl)}, {`,
    `  method: "POST",`,
    `  headers: { "Content-Type": "application/json" },`,
    `  body: JSON.stringify({ name, email, phone, company, message, source: "landing" }),`,
    `});`,
  ].join("\n");
}

export function formatLeadValue(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString()} ${currency}`;
  }
}
