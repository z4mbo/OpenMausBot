import { useRef, useState, type FormEvent } from "react";
import { AudioLines, Check, Copy, FileSpreadsheet, Loader2, Mail, MessageSquareText, Plus, RotateCw, Send, Upload, X } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation } from "@/lib/origin-cloud";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Switch } from "../SettingsPrimitives";
import { BotAvatar } from "../Avatar";
import { Field, Modal, Notice, Segmented, cardClass, ghostButton, inputClass as baseInput, primaryButton, useAction } from "../origin-pages/ui";
import {
  captureFetchSnippet, captureFormSnippet, parseLeadsCsv, type PipelineChannel, type PipelineImportRow, type PipelinePendingContact, type PipelineSettingsView,
} from "../../../shared/origin-pipeline";
import { pipelineServer } from "./pipeline-api";

const inputClass = cn(baseInput, "font-normal");

export function NewLeadDialog({ projectId, stages, onClose, onCreated }: { projectId: string; stages: readonly string[]; onClose(): void; onCreated(leadId: string): void }) {
  const [fields, setFields] = useState({ name: "", company: "", email: "", phone: "", value: "", stage: stages[0] ?? "", source: "", notes: "" });
  const action = useAction();
  const set = (key: keyof typeof fields) => (event: { target: { value: string } }) => setFields((current) => ({ ...current, [key]: event.target.value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (action.busy) return;
    const value = fields.value.trim() ? Number(fields.value.replace(",", ".")) : undefined;
    if (value !== undefined && !Number.isFinite(value)) { action.setError("Value must be a number"); return; }
    let created = "";
    const ok = await action.run(async () => {
      const result = await cloudMutation<{ leadId: string }>("pipeline:upsertLead", {
        projectId, name: fields.name, stage: fields.stage,
        ...Object.fromEntries((["company", "email", "phone", "source", "notes"] as const).filter((key) => fields[key].trim()).map((key) => [key, fields[key]])),
        ...(value !== undefined ? { value } : {}),
      });
      created = result.leadId;
    }, "Could not add the lead");
    if (ok) onCreated(created);
  };
  return (
    <Modal title="New lead" onClose={onClose} canClose={() => !action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Name"><input className={inputClass} value={fields.name} onChange={set("name")} required maxLength={200} autoFocus placeholder="Ada Lovelace" /></Field>
        <Field label="Company"><input className={inputClass} value={fields.company} onChange={set("company")} maxLength={200} /></Field>
        <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          <Field label="Email"><input className={inputClass} type="email" value={fields.email} onChange={set("email")} /></Field>
          <Field label="Phone"><input className={inputClass} type="tel" value={fields.phone} onChange={set("phone")} placeholder="+39 333 123 4567" /></Field>
          <Field label="Value"><input className={inputClass} inputMode="decimal" value={fields.value} onChange={set("value")} placeholder="0" /></Field>
          <Field label="Stage">
            <Select className="w-full" value={fields.stage} onChange={set("stage")}>{stages.map((stage) => <option key={stage} value={stage}>{stage}</option>)}</Select>
          </Field>
        </div>
        <Field label="Source"><input className={inputClass} value={fields.source} onChange={set("source")} maxLength={60} placeholder="Referral, event, cold list…" /></Field>
        <Field label="Notes"><textarea className={cn(inputClass, "min-h-[64px] resize-y")} value={fields.notes} onChange={set("notes")} maxLength={8000} /></Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton} disabled={action.busy || !fields.name.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Add lead</button>
        </div>
      </form>
    </Modal>
  );
}

export function ImportDialog({ projectId, onClose }: { projectId: string; onClose(): void }) {
  const [file, setFile] = useState<{ name: string; rows: PipelineImportRow[]; skipped: number } | null>(null);
  const [source, setSource] = useState("import");
  const [result, setResult] = useState<{ created: number; updated: number; skipped: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const action = useAction();
  const choose = async (picked: File | undefined) => {
    if (!picked) return;
    action.setError("");
    setResult(null);
    if (picked.size > 5 * 1024 * 1024) { action.setError(`${picked.name} is over 5 MB`); return; }
    const parsed = parseLeadsCsv(await picked.text());
    if (!parsed.rows.length) { action.setError("No leads found. The first row must name the columns, like name, email, phone, company."); return; }
    setFile({ name: picked.name, ...parsed });
    setSource(picked.name.replace(/\.(csv|tsv|txt)$/i, "").slice(0, 60) || "import");
  };
  const submit = async () => {
    if (!file || action.busy) return;
    await action.run(async () => setResult(await cloudMutation("pipeline:importLeads", { projectId, source, rows: file.rows })), "Could not import the leads");
  };
  return (
    <Modal title="Import leads" onClose={onClose} canClose={() => !action.busy} wide>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={() => input.current?.click()} onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => { event.preventDefault(); void choose(event.dataTransfer.files[0]); }}
          className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-hairline bg-inset px-4 py-6 text-[13px] text-ink-secondary transition-colors hover:border-accent/60 hover:text-ink">
          <FileSpreadsheet size={22} />{file ? `${file.name}: ${file.rows.length} leads${file.skipped ? `, ${file.skipped} rows skipped` : ""}` : "Choose or drop a CSV export"}
          <span className="text-[12px] text-ink-tertiary">Columns like name, first name, last name, email, phone, company, value, tags, notes, stage. A lead with a known email is updated, not duplicated.</span>
        </button>
        <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" hidden aria-label="CSV file" onChange={(event) => { void choose(event.target.files?.[0]); event.target.value = ""; }} />
        {file && (
          <div className={cn(cardClass, "overflow-x-auto")}>
            <table className="w-full min-w-[560px] text-left text-[12.5px]">
              <thead className="text-ink-tertiary"><tr>{["Name", "Company", "Email", "Phone", "Value", "Stage"].map((label) => <th key={label} scope="col" className="px-3 py-1.5 font-medium">{label}</th>)}</tr></thead>
              <tbody className="divide-y divide-hairline/30 text-ink-secondary">
                {file.rows.slice(0, 6).map((row, index) => (
                  <tr key={index}>{[row.name, row.company, row.email, row.phone, row.value, row.stage].map((cell, column) => <td key={column} className="max-w-[160px] truncate px-3 py-1.5">{cell ?? ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
            {file.rows.length > 6 && <p className="px-3 pb-2 text-[12px] text-ink-tertiary">and {file.rows.length - 6} more</p>}
          </div>
        )}
        {file && <Field label="Source"><input className={inputClass} value={source} maxLength={60} onChange={(event) => setSource(event.target.value)} /></Field>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {result && <Notice>Added {result.created}, updated {result.updated}{result.skipped ? `, skipped ${result.skipped}` : ""}.</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>{result ? "Done" : "Cancel"}</button>
          {!result && <button type="button" className={primaryButton} disabled={!file || action.busy} onClick={() => void submit()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}Import {file?.rows.length ?? ""} leads</button>}
        </div>
      </div>
    </Modal>
  );
}

function CopyBlock({ label, text, multiline = false }: { label: string; text: string; multiline?: boolean }) {
  const { state, copy } = useCopyFeedback(text);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
        {label}
        <button type="button" className={cn(ghostButton, "ml-auto h-7 min-h-7 px-2 text-[12px]")} onClick={copy}>
          {state === "copied" ? <Check size={12} /> : <Copy size={12} />}{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </button>
      </div>
      {multiline
        ? <pre className="max-h-56 overflow-auto rounded-lg border border-hairline/50 bg-inset px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink-secondary">{text}</pre>
        : <code className="block truncate rounded-lg border border-hairline/50 bg-inset px-3 py-2 font-mono text-[12px] text-ink-secondary" title={text}>{text}</code>}
    </div>
  );
}

export function CaptureDialog({ projectId, settings, canEdit, onClose }: { projectId: string; settings: PipelineSettingsView; canEdit: boolean; onClose(): void }) {
  const [snippet, setSnippet] = useState<"form" | "fetch">("form");
  const action = useAction();
  const configure = (patch: Record<string, unknown>) => action.run(() => cloudMutation("pipeline:configure", { projectId, ...patch }), "Could not change lead capture");
  return (
    <Modal title="Lead capture" onClose={onClose} wide>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <p className="flex-1 text-[13px] leading-relaxed text-ink-secondary">
            Your landing page posts its form to this project's own address, and every submission lands in New with the message on its timeline. A lead with a known email is updated, not duplicated; bursts are rate limited and a hidden field catches bots.
          </p>
          {canEdit && <Switch checked={settings.captureEnabled} aria-label="Accept leads from forms" disabled={action.busy} onClick={() => void configure({ captureEnabled: !settings.captureEnabled })} />}
        </div>
        {!settings.captureEnabled ? (
          <Notice>{canEdit ? "Turn on capture to get this project's form address." : "Lead capture is off. An editor can turn it on."}</Notice>
        ) : settings.captureUrl ? <>
          <CopyBlock label="Form address" text={settings.captureUrl} />
          <div className="flex flex-col gap-2">
            <Segmented label="Snippet" value={snippet} onChange={setSnippet} options={[{ value: "form", label: "HTML form" }, { value: "fetch", label: "JavaScript" }]} />
            <CopyBlock label={snippet === "form" ? "Paste into your page; set redirect to your thank-you page" : "Send from your own form handler"} multiline
              text={snippet === "form" ? captureFormSnippet(settings.captureUrl) : captureFetchSnippet(settings.captureUrl)} />
          </div>
          <p className="text-[12px] text-ink-tertiary">Fields: name, email, phone, company, message, source. Anyone with the address can submit, so get a new one if it leaks.</p>
          {canEdit && (
            <button type="button" className={cn(ghostButton, "self-start")} disabled={action.busy}
              onClick={() => { if (window.confirm("Get a new address? Forms using the current one stop working.")) void configure({ rotateToken: true }); }}>
              <RotateCw size={14} />Get a new address
            </button>
          )}
        </> : <Notice>Only editors see the form address.</Notice>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
      </div>
    </Modal>
  );
}

const CHANNEL_ROWS: readonly { channel: PipelineChannel; label: string; via: string; icon: typeof Mail }[] = [
  { channel: "email", label: "Email", via: "Brevo", icon: Mail },
  { channel: "sms", label: "Texts, WhatsApp and calls", via: "Twilio", icon: MessageSquareText },
  { channel: "ai_call", label: "AI calls", via: "ElevenLabs", icon: AudioLines },
];

export function PipelineSettingsDialog({ projectId, settings, canEdit, isAdmin, channels, onClose }: {
  projectId: string; settings: PipelineSettingsView; canEdit: boolean; isAdmin: boolean; channels: Record<PipelineChannel, boolean> | null; onClose(): void;
}) {
  const [currency, setCurrency] = useState(settings.currency);
  const [agentId, setAgentId] = useState(settings.aiAgentId ?? "");
  const [phoneId, setPhoneId] = useState(settings.aiPhoneNumberId ?? "");
  const action = useAction();
  const dirty = currency !== settings.currency || agentId !== (settings.aiAgentId ?? "") || phoneId !== (settings.aiPhoneNumberId ?? "");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (await action.run(() => cloudMutation("pipeline:configure", { projectId, currency, aiAgentId: agentId, aiPhoneNumberId: phoneId }), "Could not save the settings")) onClose();
  };
  return (
    <Modal title="Pipeline settings" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-4">
        <section className="flex flex-col gap-1.5">
          <h4 className="text-[12px] font-medium text-ink-secondary">Your connections</h4>
          <ul className={cn(cardClass, "divide-y divide-hairline/30")}>
            {CHANNEL_ROWS.map(({ channel, label, via, icon: Icon }) => (
              <li key={channel} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                <Icon size={14} className="text-ink-tertiary" aria-hidden="true" />
                <span className="flex-1 text-ink">{label}<span className="text-ink-tertiary"> · {via}</span></span>
                {channels === null ? <span className="text-[12px] text-ink-tertiary">Unknown</span>
                  : channels[channel] ? <span className="flex items-center gap-1 text-[12px] text-success"><Check size={12} />Connected</span>
                  : <span className="flex items-center gap-1 text-[12px] text-ink-tertiary"><X size={12} />Not connected</span>}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-ink-tertiary">Each member sends with their own keys, set under Settings &gt; Integrations. They stay on that member's computer.</p>
        </section>
        <section className="flex items-start gap-3">
          <div className="flex-1">
            <h4 className="text-[13px] font-medium text-ink">Let agents send without approval</h4>
            <p className="mt-0.5 text-[12px] leading-relaxed text-ink-secondary">Off: emails, texts and AI calls agents draft wait in Pipeline until a person approves them. Only project admins change this.</p>
          </div>
          <Switch checked={settings.autoSend} aria-label="Let agents send without approval" disabled={!isAdmin || action.busy}
            onClick={() => { if (settings.autoSend || window.confirm("Agents will email, text and call leads without asking. Turn on auto-send?")) void action.run(() => cloudMutation("pipeline:configure", { projectId, autoSend: !settings.autoSend }), "Could not change auto-send"); }} />
        </section>
        <fieldset disabled={!canEdit} className="flex flex-col gap-3">
          <Field label="Currency"><input className={cn(inputClass, "uppercase")} value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></Field>
          <div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
            <Field label="ElevenLabs agent id"><input className={inputClass} value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="agent_…" /></Field>
            <Field label="ElevenLabs phone number id"><input className={inputClass} value={phoneId} onChange={(event) => setPhoneId(event.target.value)} placeholder="phnum_…" /></Field>
          </div>
          <p className="text-[12px] leading-relaxed text-ink-tertiary">AI calls use this Conversational AI agent and the Twilio number imported into ElevenLabs. Allow prompt overrides in the agent's security settings so each call follows its own goal.</p>
        </fieldset>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Close</button>
          {canEdit && <button className={primaryButton} disabled={!dirty || action.busy}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : null}Save</button>}
        </div>
      </form>
    </Modal>
  );
}

export function PlanDialog({ chief, leads, selected, onClose, onSend }: { chief: Bot; leads: readonly { _id: string; name: string }[]; selected: boolean; onClose(): void; onSend(direction: string): void }) {
  const [direction, setDirection] = useState("");
  return (
    <Modal title="Plan outreach" onClose={onClose}>
      <form onSubmit={(event) => { event.preventDefault(); onSend(direction); }} className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5 text-[13px] text-ink-secondary">
          <BotAvatar bot={chief} size={28} />
          <p className="flex-1">{chief.name} drafts a strategy for {selected ? "the" : "your"} {leads.length} {selected ? "selected" : "open"} {leads.length === 1 ? "lead" : "leads"}, hands research to the team, and leaves first touches for your approval.</p>
        </div>
        <p className="line-clamp-2 text-[12px] text-ink-tertiary">{leads.slice(0, 8).map((lead) => lead.name).join(", ")}{leads.length > 8 ? ` and ${leads.length - 8} more` : ""}</p>
        <Field label="Direction (optional)">
          <textarea className={cn(inputClass, "min-h-[84px] resize-y")} value={direction} onChange={(event) => setDirection(event.target.value)} autoFocus
            placeholder="Focus on agencies, push the annual plan, keep it friendly and short" />
        </Field>
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton}><Send size={14} />Send to {chief.name}</button>
        </div>
      </form>
    </Modal>
  );
}

const PENDING_LABEL: Record<string, string> = { email: "Email", sms: "Text", whatsapp: "WhatsApp", call: "Call", ai_call: "AI call" };

export function PendingContacts({ projectId, pending, canEdit, botId, onOpen, onError }: {
  projectId: string; pending: readonly PipelinePendingContact[]; canEdit: boolean; botId: string; onOpen(leadId: string): void; onError(message: string): void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(pending.length <= 3);
  const review = async (row: PipelinePendingContact, approve: boolean) => {
    setBusy(row._id);
    try {
      await cloudMutation("pipeline:reviewContact", { projectId, activityId: row._id, approve });
      if (approve) await pipelineServer.send({ projectId, activityId: row._id, botId });
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not send");
    } finally {
      setBusy(null);
    }
  };
  const shown = expanded ? pending : pending.slice(0, 3);
  return (
    <section className={cn(cardClass, "overflow-hidden")} aria-label="Waiting for approval">
      <header className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
        <span className="size-1.5 rounded-full bg-accent" aria-hidden="true" />
        <strong className="font-medium text-ink">{pending.length} {pending.length === 1 ? "contact waits" : "contacts wait"} for approval</strong>
        <span className="text-ink-tertiary">Agents drafted these; nothing goes out until you approve.</span>
        {pending.length > 3 && <button type="button" className="ml-auto text-ink-secondary hover:text-ink" onClick={() => setExpanded((open) => !open)}>{expanded ? "Show fewer" : "Show all"}</button>}
      </header>
      <ul className="divide-y divide-hairline/30 border-t border-hairline/30">
        {shown.map((row) => (
          <li key={row._id} className="flex items-center gap-3 px-3 py-2 text-[12.5px]">
            <span className="w-16 shrink-0 text-ink-tertiary">{PENDING_LABEL[row.kind] ?? row.kind}</span>
            <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline" onClick={() => onOpen(row.leadId)}>
              <span className="font-medium">{row.leadName}</span>
              <span className="text-ink-secondary"> · {row.subject ?? row.goal ?? row.body ?? ""}</span>
            </button>
            <span className="hidden shrink-0 text-ink-tertiary sm:inline">{row.actor.name}</span>
            {canEdit && <>
              <button type="button" className={cn(primaryButton, "h-7 min-h-7 rounded-full px-3 text-[12px]")} disabled={busy !== null} onClick={() => void review(row, true)}>
                {busy === row._id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}Approve
              </button>
              <button type="button" className={cn(ghostButton, "h-7 min-h-7 rounded-full px-2.5 text-[12px]")} disabled={busy !== null} aria-label={`Discard the ${PENDING_LABEL[row.kind] ?? row.kind} to ${row.leadName}`} onClick={() => void review(row, false)}><X size={12} /></button>
            </>}
          </li>
        ))}
      </ul>
    </section>
  );
}
