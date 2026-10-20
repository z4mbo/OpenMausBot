import { useState, type FormEvent } from "react";
import { Check, GitMerge, Loader2, Plus, Trash2 } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Field, Modal, Notice, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { formatLeadValue, type PipelineLead } from "../../../shared/origin-pipeline";
import { leadSources, type SalesReplyChannel, type SalesTemplate } from "../../../shared/origin-sales";

type TemplateDraft = { id?: string; name: string; channel: SalesReplyChannel | ""; subject: string; body: string };
const BLANK: TemplateDraft = { name: "", channel: "", subject: "", body: "" };

export function TemplatesDialog({ projectId, templates, onClose }: { projectId: string; templates: readonly SalesTemplate[]; onClose(): void }) {
  const [draft, setDraft] = useState<TemplateDraft | null>(templates.length ? null : BLANK);
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft || action.busy) return;
    const ok = await action.run(() => cloudMutation("pipelineInbox:saveTemplate", {
      projectId, name: draft.name, body: draft.body, ...(draft.id ? { templateId: draft.id } : {}), ...(draft.channel ? { channel: draft.channel } : {}),
      ...(draft.channel !== "sms" && draft.channel !== "whatsapp" && draft.subject.trim() ? { subject: draft.subject } : {}),
    }), "Could not save the template");
    if (ok) setDraft(null);
  };
  const remove = (row: SalesTemplate) => {
    if (window.confirm(`Delete the template ${row.name}?`)) void action.run(() => cloudMutation("pipelineInbox:removeTemplate", { projectId, templateId: row._id }), "Could not delete the template");
  };
  return (
    <Modal title="Reply templates" onClose={onClose} canClose={() => !action.busy}>
      <div className="flex flex-col gap-3">
        {templates.length > 0 && (
          <ul className={cn(cardClass, "divide-y divide-hairline/30")}>
            {templates.map((row) => (
              <li key={row._id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
                <button type="button" className="min-w-0 flex-1 truncate text-left text-ink hover:underline"
                  onClick={() => setDraft({ id: row._id, name: row.name, channel: row.channel ?? "", subject: row.subject ?? "", body: row.body })}>
                  {row.name}<span className="text-ink-tertiary"> · {row.channel ? { email: "Email", sms: "Text", whatsapp: "WhatsApp" }[row.channel] : "Any channel"}</span>
                </button>
                <button type="button" className={cn(iconButton, "size-7 hover:text-danger")} aria-label={`Delete ${row.name}`} onClick={() => remove(row)}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
        {draft ? (
          <form onSubmit={save} className="flex flex-col gap-2.5">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <Field label="Name"><input className={inputClass} value={draft.name} maxLength={80} required onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Pricing follow-up" /></Field>
              <Field label="Channel">
                <Select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as TemplateDraft["channel"] })}>
                  <option value="">Any</option><option value="email">Email</option><option value="sms">Text</option><option value="whatsapp">WhatsApp</option>
                </Select>
              </Field>
            </div>
            {draft.channel !== "sms" && draft.channel !== "whatsapp" && (
              <Field label="Email subject"><input className={inputClass} value={draft.subject} maxLength={300} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} /></Field>
            )}
            <Field label="Text: {first_name}, {name} and {company} fill in">
              <textarea className={cn(inputClass, "min-h-[110px] resize-y")} value={draft.body} required maxLength={20000} onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                placeholder="Hi {first_name}, thanks for your interest in…" />
            </Field>
            {action.error && <Notice tone="danger">{action.error}</Notice>}
            <div className="flex justify-end gap-2">
              <button type="button" className={ghostButton} onClick={() => (templates.length ? setDraft(null) : onClose())}>Cancel</button>
              <button className={primaryButton} disabled={action.busy || !draft.name.trim() || !draft.body.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save template</button>
            </div>
          </form>
        ) : (
          <div className="flex justify-between gap-2">
            {action.error ? <Notice tone="danger">{action.error}</Notice> : <span />}
            <button type="button" className={primaryButton} onClick={() => setDraft(BLANK)}><Plus size={14} />New template</button>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function MergeDialog({ projectId, groups, currency, onClose }: { projectId: string; groups: readonly PipelineLead[][]; currency: string; onClose(): void }) {
  const [primary, setPrimary] = useState<Record<number, string>>({});
  const [done, setDone] = useState<ReadonlySet<number>>(new Set());
  const action = useAction();
  const keep = (index: number, group: readonly PipelineLead[]) => primary[index] ?? [...group].sort((a, b) => a.createdAt - b.createdAt)[0]!._id;
  const merge = (index: number, group: readonly PipelineLead[]) => {
    const primaryId = keep(index, group);
    void action.run(async () => {
      await cloudMutation("pipelineContacts:merge", { projectId, primaryId, otherIds: group.filter((lead) => lead._id !== primaryId).map((lead) => lead._id) });
      setDone((current) => new Set(current).add(index));
    }, "Could not merge the contacts");
  };
  const open = groups.map((group, index) => ({ group, index })).filter(({ index }) => !done.has(index));
  return (
    <Modal title="Possible duplicates" onClose={onClose} canClose={() => !action.busy} wide>
      <div className="flex flex-col gap-3">
        {!open.length && <Notice>No duplicates left. Contacts that share an email address or a phone number show here.</Notice>}
        {open.map(({ group, index }) => (
          <fieldset key={group.map((lead) => lead._id).join()} className={cn(cardClass, "flex flex-col gap-1 p-2")}>
            <legend className="sr-only">Duplicates of {group[0]!.name}</legend>
            {group.map((lead) => (
              <label key={lead._id} className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-raised/40">
                <input type="radio" name={`keep-${index}`} className="mt-1 accent-[var(--color-accent)]" checked={keep(index, group) === lead._id} onChange={() => setPrimary({ ...primary, [index]: lead._id })} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-ink">{lead.name}</span>{lead.company && <span className="text-ink-secondary"> · {lead.company}</span>}
                  <span className="block truncate text-[12px] text-ink-tertiary">
                    {[lead.email, lead.phone, lead.stage, lead.value ? formatLeadValue(lead.value, currency) : "", leadSources(lead).join(", ")].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {keep(index, group) === lead._id && <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-px text-[11px] text-accent-text">Keep</span>}
              </label>
            ))}
            <div className="flex justify-end px-1 pt-1">
              <button type="button" className={cn(primaryButton, "h-7 min-h-7 rounded-full px-3 text-[12px]")} disabled={action.busy} onClick={() => merge(index, group)}>
                {action.busy ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}Merge {group.length}
              </button>
            </div>
          </fieldset>
        ))}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end"><button type="button" className={ghostButton} onClick={onClose}>Done</button></div>
      </div>
    </Modal>
  );
}

export function SaveViewDialog({ projectId, summary, filters, onClose, onSaved }: { projectId: string; summary: string; filters: Record<string, unknown>; onClose(): void; onSaved(viewId: string): void }) {
  const [name, setName] = useState("");
  const action = useAction();
  const save = async (event: FormEvent) => {
    event.preventDefault();
    let saved = "";
    if (await action.run(async () => { saved = await cloudMutation<string>("pipelineContacts:saveView", { projectId, name, filters }); }, "Could not save the view")) onSaved(saved);
  };
  return (
    <Modal title="Save view" onClose={onClose} canClose={() => !action.busy}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Name"><input className={inputClass} value={name} maxLength={60} required autoFocus onChange={(event) => setName(event.target.value)} placeholder="Warm leads in Italy" /></Field>
        <p className="text-[12px] text-ink-tertiary">{summary}</p>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton} disabled={action.busy || !name.trim()}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save view</button>
        </div>
      </form>
    </Modal>
  );
}

export function NewDealDialog({ projectId, leads, onClose, onCreated }: { projectId: string; leads: readonly PipelineLead[]; onClose(): void; onCreated(leadId: string): void }) {
  const [leadId, setLeadId] = useState(leads[0]?._id ?? "");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const action = useAction();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const amount = value.trim() ? Number(value.replace(",", ".")) : undefined;
    if (amount !== undefined && !Number.isFinite(amount)) { action.setError("Value must be a number"); return; }
    if (await action.run(() => cloudMutation("pipelineDeals:upsert", { projectId, leadId, ...(title.trim() ? { title } : {}), ...(amount !== undefined ? { value: amount } : {}) }), "Could not open the deal")) onCreated(leadId);
  };
  return (
    <Modal title="New deal" onClose={onClose} canClose={() => !action.busy}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Contact">
          <Select className="w-full" value={leadId} onChange={(event) => setLeadId(event.target.value)}>
            {leads.map((lead) => <option key={lead._id} value={lead._id}>{lead.name}{lead.company ? ` · ${lead.company}` : ""}</option>)}
          </Select>
        </Field>
        <Field label="Deal"><input className={inputClass} value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="Annual plan" /></Field>
        <Field label="Value"><input className={inputClass} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)} placeholder="0" /></Field>
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button className={primaryButton} disabled={action.busy || !leadId}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}Open deal</button>
        </div>
      </form>
    </Modal>
  );
}
