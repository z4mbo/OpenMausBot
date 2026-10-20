import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowRight, AudioLines, Building2, Check, ChevronDown, CircleDollarSign, Inbox, Loader2, Mail, MessageCircle, MessageSquareText, Phone, Send, Sparkles,
  StickyNote, Tag, Trash2, UserRound, X,
} from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { ModalFocusScope, useModalDialog } from "@/hooks/use-modal-dialog";
import { ChipSelect, DateChip } from "../origin-pages/issue-fields";
import { Field, Loading, Notice, Segmented, chipButton, ghostButton, iconButton, inputClass, overlayMotion, primaryButton, useAction, useDismiss } from "../origin-pages/ui";
import {
  normalizeLeadPhone, type PipelineActivity, type PipelineChannel, type PipelineLead, type PipelineSettingsView,
} from "../../../shared/origin-pipeline";
import { ownerKey } from "./pipeline-model";
import { pipelineServer, rememberCallerPhone, rememberedCallerPhone } from "./pipeline-api";
import { OwnerAvatar, type OwnerOption } from "./owners";
import { SequencePanel } from "./SequencePanel";
import { InsightRow } from "./LeadInsight";
import type { LeadInsight } from "./pipeline-model";
import { KIND_ICON, KIND_LABEL, STATUS_LABEL, statusTone, when } from "./activity-labels";
import { useActivityActions } from "./activity-actions";
import { ActivityControls, DraftFields, hasControls } from "./DraftControls";
import { ClampedText, Conversation } from "./Conversation";
import { DealPanel } from "./DealPanel";
import { leadSources } from "../../../shared/origin-sales";

type Compose = "note" | PipelineChannel;
type EditableField = "name" | "company" | "email" | "phone" | "source" | "notes" | "nextStep" | "value" | "tags";

const COMPOSE: readonly { value: Compose; label: string; icon: ReactNode }[] = [
  { value: "note", label: "Note", icon: <StickyNote size={13} /> },
  { value: "email", label: "Email", icon: <Mail size={13} /> },
  { value: "sms", label: "Text", icon: <MessageSquareText size={13} /> },
  { value: "whatsapp", label: "WhatsApp", icon: <MessageCircle size={13} /> },
  { value: "call", label: "Call", icon: <Phone size={13} /> },
  { value: "ai_call", label: "AI call", icon: <AudioLines size={13} /> },
];

export type DrawerTab = "conversation" | "deals" | "activity";

export function LeadDrawer({ projectId, projectName, leadId, stages, currency, canEdit, owners, chief, channels, stripe, settings, insight, initialTab = "conversation", onClose, onPlan, onSequence }: {
  projectId: string; projectName: string; leadId: string; stages: readonly string[]; currency: string; canEdit: boolean; owners: readonly OwnerOption[];
  chief: Bot; channels: Record<PipelineChannel, boolean> | null; stripe: boolean; settings: PipelineSettingsView; insight?: LeadInsight; initialTab?: DrawerTab;
  onClose(): void; onPlan(lead: PipelineLead): void; onSequence(lead: PipelineLead): void;
}) {
  const detail = useCloudQuery<{ lead: PipelineLead; activities: PipelineActivity[] } | null>("pipeline:lead", { projectId, leadId });
  const panel = useRef<HTMLDivElement>(null);
  const heading = useId();
  const [edits, setEdits] = useState<Partial<Record<EditableField, string>>>({});
  const { closing, dismiss: animateOut } = useDismiss(onClose);
  const dirty = Object.keys(edits).length > 0;
  const { dismiss } = useModalDialog(panel, animateOut, { canClose: () => !(dirty && canEdit) || window.confirm("Discard unsaved changes?") });
  const action = useAction();
  const [tab, setTab] = useState<DrawerTab>(initialTab);
  const lead = detail?.lead;

  useEffect(() => {
    if (detail === null) onClose();
  }, [detail, onClose]);

  const unread = lead?.unreadReplies ?? 0;
  useEffect(() => {
    if (unread) void cloudMutation("pipeline:markRead", { projectId, leadId }).catch(() => undefined);
  }, [unread, projectId, leadId]);

  const original = (field: EditableField): string => {
    if (!lead) return "";
    if (field === "value") return lead.value ? String(lead.value) : "";
    if (field === "tags") return lead.tags.join(", ");
    return lead[field] ?? "";
  };
  const value = (field: EditableField) => edits[field] ?? original(field);
  const edit = (field: EditableField, next: string) => setEdits((current) => {
    const copy = { ...current };
    if (next === original(field)) delete copy[field];
    else copy[field] = next;
    return copy;
  });
  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!dirty || action.busy || !lead) return;
    const patch: Record<string, unknown> = {};
    for (const [field, raw] of Object.entries(edits) as [EditableField, string][]) {
      if (field === "value") patch.value = raw.trim() ? Number(raw.replace(",", ".")) : null;
      else if (field === "tags") patch.tags = raw.split(",").map((tag) => tag.trim()).filter(Boolean);
      else patch[field] = raw;
    }
    if (typeof patch.value === "number" && !Number.isFinite(patch.value)) { action.setError("Value must be a number"); return; }
    if (await action.run(() => cloudMutation("pipeline:upsertLead", { projectId, leadId, ...patch }), "Could not save the lead")) setEdits({});
  };
  const update = (patch: Record<string, unknown>, fallback: string) => void action.run(() => cloudMutation("pipeline:upsertLead", { projectId, leadId, ...patch }), fallback);
  const remove = () => {
    if (!lead || !window.confirm(`Delete ${lead.name} and their timeline?`)) return;
    void action.run(async () => { await cloudMutation("pipeline:removeLead", { projectId, leadId }); onClose(); }, "Could not delete the lead");
  };
  const ownerOptions = [{ value: "", label: "No owner", icon: <UserRound size={14} /> }, ...owners.map((owner) => ({ value: ownerKey(owner), label: owner.kind === "agent" ? `${owner.name} (agent)` : owner.name, icon: owner.avatar }))];

  return (
    <div className={cn("fixed inset-0 z-50 flex justify-end bg-black/45", overlayMotion(closing))} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={heading} tabIndex={-1} style={{ outline: "none" }}
        className={cn("flex h-full w-full max-w-[600px] flex-col border-l border-hairline/60 bg-app transition-[transform,opacity] duration-(--motion-exit) ease-in motion-reduce:transition-none",
          "motion-safe:animate-panel-in", closing && "translate-x-6 opacity-0")}>
        <ModalFocusScope panelRef={panel}>
          <header className="flex items-center gap-2 border-b border-hairline/40 px-5 py-3">
            <span className="text-[12.5px] text-ink-tertiary">{projectName} · Contact</span>
            <div className="ml-auto flex items-center">
              {lead && <button type="button" className={cn(ghostButton, "mr-1 h-8 min-h-8 rounded-full")} title={`Ask ${chief.name} to plan outreach for this lead`} onClick={() => onPlan(lead)}><Sparkles size={13} />Plan</button>}
              {lead && canEdit && <button type="button" className={cn(iconButton, "hover:text-danger")} aria-label="Delete lead" title="Delete lead" onClick={remove}><Trash2 size={15} /></button>}
              <button type="button" className={iconButton} aria-label="Close" onClick={dismiss}><X size={16} /></button>
            </div>
          </header>
          {!lead ? <div className="p-5"><Loading label="Opening lead" variant="inline" /></div> : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <form onSubmit={save} className="px-5 pb-4 pt-4" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save(); } }}>
                <fieldset disabled={!canEdit} className="contents">
                  <input id={heading} aria-label="Name" value={value("name")} maxLength={200} onChange={(event) => edit("name", event.target.value)}
                    className="w-full bg-transparent text-[22px] font-semibold tracking-[-0.01em] text-ink outline-none placeholder:text-ink-tertiary disabled:opacity-100" />
                  <label className="mt-0.5 flex items-center gap-1.5 text-[13.5px] text-ink-secondary">
                    <Building2 size={13} className="shrink-0 text-ink-tertiary" aria-hidden="true" />
                    <input aria-label="Company" placeholder="Company" value={value("company")} maxLength={200} onChange={(event) => edit("company", event.target.value)}
                      className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-ink-tertiary disabled:opacity-100" />
                  </label>
                </fieldset>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <ChipSelect label="Stage" value={lead.stage} options={stages.map((stage) => ({ value: stage, label: stage }))} icon={<ArrowRight size={14} aria-hidden="true" />} disabled={!canEdit}
                    onChange={(stage) => void action.run(() => cloudMutation("pipeline:moveLead", { projectId, leadId, stage }), "Could not move the lead")} />
                  <ChipSelect label="Owner" value={ownerKey(lead.owner)} options={ownerOptions} placeholder="Owner" icon={lead.owner ? <OwnerAvatar owner={lead.owner} owners={owners} size={16} /> : <UserRound size={14} aria-hidden="true" />} disabled={!canEdit}
                    onChange={(key) => {
                      const owner = owners.find((option) => ownerKey(option) === key);
                      update({ owner: owner ? { kind: owner.kind, name: owner.name, ...(owner.id ? { id: owner.id } : {}) } : null }, "Could not change the owner");
                    }} />
                  <DateChip value={lead.nextDue ?? ""} disabled={!canEdit} onChange={(nextDue) => update({ nextDue }, "Could not change the date")} />
                  <span className={cn(chipButton, "cursor-default gap-1 hover:bg-raised/60")} title={`Sources: ${leadSources(lead).join(", ")}`}><Inbox size={13} aria-hidden="true" />
                    <span className="truncate">{leadSources(lead).join(" · ")}</span></span>
                </div>
                {insight && insight.reasons.length > 1 && <InsightRow insight={insight} />}
                <fieldset disabled={!canEdit} className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 max-sm:grid-cols-1">
                  <Field label="Email"><input className={inputClass} type="email" value={value("email")} onChange={(event) => edit("email", event.target.value)} placeholder="name@company.com" /></Field>
                  <Field label="Phone"><input className={inputClass} type="tel" value={value("phone")} onChange={(event) => edit("phone", event.target.value)} placeholder="+39 333 123 4567" /></Field>
                  <Field label={`Value (${currency})`}>
                    <span className="relative flex items-center"><CircleDollarSign size={13} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
                      <input className={cn(inputClass, "pl-7 tabular-nums")} inputMode="decimal" value={value("value")} onChange={(event) => edit("value", event.target.value)} placeholder="0" /></span>
                  </Field>
                  <Field label="Tags">
                    <span className="relative flex items-center"><Tag size={13} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
                      <input className={cn(inputClass, "pl-7")} value={value("tags")} onChange={(event) => edit("tags", event.target.value)} placeholder="warm, saas" /></span>
                  </Field>
                  <Field label="Next step" className="col-span-2 max-sm:col-span-1"><input className={inputClass} value={value("nextStep")} maxLength={300} onChange={(event) => edit("nextStep", event.target.value)} placeholder="Send the proposal" /></Field>
                  <Field label="Notes" className="col-span-2 max-sm:col-span-1">
                    <textarea className={cn(inputClass, "min-h-[72px] resize-y")} value={value("notes")} maxLength={8000} onChange={(event) => edit("notes", event.target.value)} placeholder="What you know about them" />
                  </Field>
                </fieldset>
                {action.error && <div className="mt-3"><Notice tone="danger">{action.error}</Notice></div>}
                {canEdit && dirty && (
                  <div className="mt-3 flex items-center justify-end gap-2 motion-safe:animate-pop-in">
                    <span className="mr-auto text-[12px] text-ink-tertiary">Ctrl+Enter to save</span>
                    <button type="button" className={cn(ghostButton, "rounded-full")} onClick={() => setEdits({})}>Discard</button>
                    <button className={cn(primaryButton, "rounded-full px-4")} disabled={action.busy}>{action.busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}Save</button>
                  </div>
                )}
              </form>
              <div className="border-t border-hairline/40 px-5 pt-3">
                <Segmented label="Contact section" value={tab} onChange={setTab}
                  options={[{ value: "conversation", label: "Conversation" }, { value: "deals", label: "Deals" }, { value: "activity", label: "Activity" }]} />
              </div>
              {tab === "conversation" && (
                <div className="px-5 pb-8 pt-3">
                  <Conversation projectId={projectId} projectName={projectName} lead={lead} activities={detail?.activities ?? []} canEdit={canEdit} chief={chief} channels={channels} />
                </div>
              )}
              {tab === "deals" && <DealPanel projectId={projectId} projectName={projectName} lead={lead} stages={stages} currency={currency} canEdit={canEdit} stripe={stripe} liveStripe={Boolean(settings.stripeWebhook?.signing)} chief={chief} channels={channels} />}
              {tab === "activity" && <>
                {canEdit && <Composer projectId={projectId} projectName={projectName} lead={lead} chief={chief} channels={channels} settings={settings} dirty={dirty} />}
                <SequencePanel projectId={projectId} lead={lead} canEdit={canEdit} chief={chief} onAsk={() => onSequence(lead)} />
                <Timeline projectId={projectId} lead={lead} activities={detail?.activities ?? []} canEdit={canEdit} chief={chief} />
              </>}
            </div>
          )}
        </ModalFocusScope>
      </div>
    </div>
  );
}

function aiGoal(lead: PipelineLead, projectName: string): string {
  return `You are calling ${lead.name}${lead.company ? ` at ${lead.company}` : ""} for ${projectName}. Introduce yourself as an AI assistant, ask whether now is a good time, `
    + "learn what they need, and if they are interested, agree a time for a 20-minute call with the team. Be brief and friendly, and end politely if they are not interested.";
}

function Composer({ projectId, projectName, lead, chief, channels, settings, dirty }: {
  projectId: string; projectName: string; lead: PipelineLead; chief: Bot; channels: Record<PipelineChannel, boolean> | null; settings: PipelineSettingsView; dirty: boolean;
}) {
  const [mode, setMode] = useState<Compose>("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [goal, setGoal] = useState(() => aiGoal(lead, projectName));
  const [callerPhone, setCallerPhone] = useState(rememberedCallerPhone);
  const [info, setInfo] = useState("");
  const action = useAction();
  const blocked = ((): string => {
    if (mode === "note") return "";
    if (mode === "email" && !lead.email) return "Add an email address to write to this lead.";
    if (mode !== "email" && !lead.phone) return "Add a phone number with its country code to reach this lead.";
    if (dirty) return "Save the lead's changes first.";
    if (channels && !channels[mode]) return `Connect ${mode === "email" ? "Brevo" : mode === "ai_call" ? "ElevenLabs" : "Twilio"} under Settings > Integrations first; the keys stay on this computer.`;
    if (mode === "ai_call" && (!settings.aiAgentId || !settings.aiPhoneNumberId)) return "Set the ElevenLabs agent and phone number in Pipeline settings first.";
    return "";
  })();
  const ready = !blocked && (mode === "note" ? body.trim() : mode === "email" ? subject.trim() && body.trim() : mode === "call" ? normalizeLeadPhone(callerPhone) : mode === "ai_call" ? goal.trim() : body.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready || action.busy) return;
    setInfo("");
    const ok = await action.run(async () => {
      if (mode === "note") {
        await cloudMutation("pipeline:logActivity", { projectId, leadId: lead._id, kind: "note", body });
        return;
      }
      const { activityId } = await cloudMutation<{ activityId: string }>("pipeline:draftContact", {
        projectId, leadId: lead._id, channel: mode,
        ...(mode === "email" ? { subject, body } : mode === "ai_call" ? { goal } : mode === "call" ? {} : { body }),
      });
      if (mode === "call") rememberCallerPhone(callerPhone);
      const result = await pipelineServer.send({ projectId, activityId, botId: chief.id, ...(mode === "call" ? { callerPhone } : {}) });
      setInfo(result.message);
    }, mode === "note" ? "Could not save the note" : "Could not reach the lead");
    if (ok) { setBody(""); setSubject(""); }
  };
  return (
    <section className="border-t border-hairline/40 px-5 py-4" aria-label="Reach out">
      <div role="tablist" aria-label="Reach out with" className="mb-3 flex flex-wrap gap-1">
        {COMPOSE.map((item) => (
          <button key={item.value} type="button" role="tab" aria-selected={mode === item.value} onClick={() => { setMode(item.value); setInfo(""); action.setError(""); }}
            className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
              mode === item.value && "bg-raised text-ink")}>
            {item.icon}{item.label}
          </button>
        ))}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2" onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }}>
        {mode === "email" && <input className={inputClass} aria-label="Subject" placeholder={`Subject · to ${lead.email ?? "no email"}`} value={subject} maxLength={300} onChange={(event) => setSubject(event.target.value)} />}
        {mode === "call" && (
          <Field label="Your phone: Twilio rings you first, then connects the lead">
            <input className={inputClass} type="tel" placeholder="+39 333 123 4567" value={callerPhone} onChange={(event) => setCallerPhone(event.target.value)} />
          </Field>
        )}
        {mode === "ai_call" ? (
          <Field label={`Goal and script for the AI agent calling ${lead.phone ?? "the lead"}`}>
            <textarea className={cn(inputClass, "min-h-[96px] resize-y")} value={goal} maxLength={8000} onChange={(event) => setGoal(event.target.value)} />
          </Field>
        ) : mode !== "call" && (
          <textarea className={cn(inputClass, "min-h-[84px] resize-y")} aria-label={mode === "note" ? "Note" : "Message"} value={body} maxLength={mode === "sms" ? 1600 : 20000}
            placeholder={mode === "note" ? "Write a note about this lead" : mode === "email" ? "Write the email" : `Message to ${lead.phone ?? "no phone"}`} onChange={(event) => setBody(event.target.value)} />
        )}
        {blocked && <p className="text-[12px] text-ink-tertiary">{blocked}</p>}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        {info && <Notice>{info}</Notice>}
        <div className="flex items-center gap-2">
          {mode === "sms" && <span className="text-[11.5px] tabular-nums text-ink-tertiary">{body.length} characters</span>}
          <button className={cn(primaryButton, "ml-auto h-8 rounded-full px-4")} disabled={!ready || action.busy}>
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : mode === "note" ? <Check size={14} /> : mode === "call" || mode === "ai_call" ? <Phone size={14} /> : <Send size={14} />}
            {mode === "note" ? "Add note" : mode === "email" ? "Send email" : mode === "call" ? "Call me first" : mode === "ai_call" ? "Start AI call" : "Send"}
          </button>
        </div>
      </form>
    </section>
  );
}

function Timeline({ projectId, lead, activities, canEdit, chief }: { projectId: string; lead: PipelineLead; activities: readonly PipelineActivity[]; canEdit: boolean; chief: Bot }) {
  return (
    <section className="border-t border-hairline/40 px-5 pb-8 pt-4" aria-label="Timeline">
      <h3 className="mb-3 text-[13px] font-semibold text-ink">Timeline <span className="font-normal tabular-nums text-ink-tertiary">{activities.length + 1}</span></h3>
      <ol className="relative flex flex-col gap-3 before:absolute before:bottom-2 before:left-[11px] before:top-2 before:w-px before:bg-hairline/50">
        {activities.map((activity) => <ActivityRow key={activity._id} projectId={projectId} leadId={lead._id} activity={activity} canEdit={canEdit} chief={chief} />)}
        <li className="relative flex gap-3 text-[12.5px] text-ink-tertiary">
          <span className="z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border border-hairline/50 bg-app"><Inbox size={12} /></span>
          <span className="pt-1">Added from {lead.source} · {when(lead.createdAt)}</span>
        </li>
      </ol>
    </section>
  );
}

function ActivityRow({ projectId, leadId, activity, canEdit, chief }: { projectId: string; leadId: string; activity: PipelineActivity; canEdit: boolean; chief: Bot }) {
  const actions = useActivityActions(projectId, leadId, activity, chief.id);
  const [transcript, setTranscript] = useState(false);
  const status = STATUS_LABEL[activity.status];
  const received = activity.status === "received";
  const title = activity.kind === "stage" ? <>Moved from {activity.subject} <ArrowRight size={11} className="inline" aria-hidden="true" /> {activity.body}</>
    : activity.kind === "deal" ? <>Deal · {activity.subject}</>
    : received ? activity.kind === "call" ? "Called in" : `${KIND_LABEL[activity.kind]} reply` : KIND_LABEL[activity.kind];
  return (
    <li className="relative flex gap-3 motion-safe:animate-msg-in">
      <span className={cn("z-[1] flex size-6 shrink-0 items-center justify-center rounded-full border bg-app",
        activity.status === "pending" || received ? "border-accent/60 text-accent-text" : activity.status === "failed" ? "border-danger/60 text-danger" : "border-hairline/50 text-ink-secondary")}>
        {KIND_ICON[activity.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-0.5 text-[12.5px]">
          <strong className="font-medium text-ink">{title}</strong>
          {status && activity.kind !== "note" && activity.kind !== "deal" && !received && (
            <span className={cn("rounded-full px-1.5 py-px text-[11px]", statusTone(activity.status))}>
              {activity.status === "in_progress" && <span className="mr-1 inline-block size-1.5 rounded-full bg-current align-middle motion-safe:animate-pulse" aria-hidden="true" />}{status}
            </span>
          )}
          <span className="text-ink-tertiary">{activity.actor.name}{activity.actor.kind === "agent" ? " (agent)" : ""} · {when(activity.createdAt)}</span>
        </header>
        {actions.draft ? <DraftFields activity={activity} actions={actions} /> : <>
          {activity.subject && activity.kind !== "stage" && activity.kind !== "deal" && <p className="mt-0.5 text-[13px] font-medium text-ink-secondary">{activity.subject}</p>}
          {activity.goal && <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-ink-secondary"><span className="text-ink-tertiary">Goal: </span>{activity.goal}</p>}
          {activity.body && activity.kind !== "stage" && activity.kind !== "import" && <ClampedText text={activity.body} />}
        </>}
        {activity.summary && <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-raised/40 px-3 py-2 text-[12.5px] leading-relaxed text-ink-secondary">{activity.summary}</div>}
        {activity.transcript && (
          <div className="mt-1.5">
            <button type="button" className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink" aria-expanded={transcript} onClick={() => setTranscript((open) => !open)}>
              <ChevronDown size={12} className={cn("transition-transform duration-(--motion-fast)", transcript && "rotate-180")} />Transcript
            </button>
            {transcript && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-hairline/40 px-3 py-2 font-sans text-[12px] leading-relaxed text-ink-secondary">{activity.transcript}</pre>}
          </div>
        )}
        {activity.error && <p className="mt-1 text-[12px] text-danger">{activity.error}</p>}
        {canEdit && hasControls(activity) && <ActivityControls activity={activity} actions={actions} />}
      </div>
    </li>
  );
}
