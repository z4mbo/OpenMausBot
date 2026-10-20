import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Loader2, Send, Sparkles } from "lucide-react";
import type { Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Notice, inputClass, primaryButton, ghostButton, useAction } from "../origin-pages/ui";
import { fillLeadTemplate, type PipelineActivity, type PipelineChannel, type PipelineLead } from "../../../shared/origin-pipeline";
import { CONVERSATION_KINDS, replyChannelFor, replySubject, type SalesReplyChannel, type SalesTemplate } from "../../../shared/origin-sales";
import { KIND_ICON, KIND_LABEL, STATUS_LABEL, statusTone, when } from "./activity-labels";
import { useActivityActions } from "./activity-actions";
import { ActivityControls, DraftFields, hasControls } from "./DraftControls";
import { pipelineServer } from "./pipeline-api";
import { TemplatesDialog } from "./SalesDialogs";

const REPLY_LABEL: Record<SalesReplyChannel, string> = { email: "Email", sms: "Text", whatsapp: "WhatsApp" };
const PROVIDER: Record<SalesReplyChannel, string> = { email: "Brevo", sms: "Twilio", whatsapp: "Twilio" };

export function ClampedText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 280 || text.split("\n").length > 4;
  return (
    <div className={cn("mt-0.5", className)}>
      <p className={cn("whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink-secondary", long && !open && "line-clamp-4")}>{text}</p>
      {long && <button type="button" className="text-[12px] text-ink-tertiary hover:text-ink" onClick={() => setOpen((value) => !value)}>{open ? "Show less" : "Show more"}</button>}
    </div>
  );
}

export function Conversation({ projectId, projectName, lead, activities, canEdit, chief, channels }: {
  projectId: string; projectName: string; lead: PipelineLead; activities: readonly PipelineActivity[]; canEdit: boolean; chief: Bot; channels: Record<PipelineChannel, boolean> | null;
}) {
  const messages = useMemo(() => activities.filter((row) => (CONVERSATION_KINDS.has(row.kind) && row.status !== "discarded") || row.kind === "deal")
    .sort((a, b) => a.createdAt - b.createdAt), [activities]);
  const end = useRef<HTMLDivElement>(null);
  const last = messages[messages.length - 1]?._id;
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [last]);
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <ol className="flex flex-col gap-2.5" aria-label={`Conversation with ${lead.name}`}>
        {!messages.length && <li className="py-6 text-center text-[12.5px] text-ink-tertiary">No messages with {lead.name} yet.</li>}
        {messages.map((row) => row.kind === "deal"
          ? <li key={row._id} className="text-center text-[11.5px] text-ink-tertiary">{row.subject} · {row.body} · {when(row.createdAt)}</li>
          : <Message key={row._id} projectId={projectId} leadId={lead._id} leadName={lead.name} activity={row} canEdit={canEdit} chief={chief} />)}
      </ol>
      <div ref={end} />
      {canEdit && <ReplyBox projectId={projectId} projectName={projectName} lead={lead} activities={activities} chief={chief} channels={channels} />}
    </div>
  );
}

function Message({ projectId, leadId, leadName, activity, canEdit, chief }: { projectId: string; leadId: string; leadName: string; activity: PipelineActivity; canEdit: boolean; chief: Bot }) {
  const actions = useActivityActions(projectId, leadId, activity, chief.id);
  const [transcript, setTranscript] = useState(false);
  const inbound = activity.status === "received";
  const call = activity.kind === "call" || activity.kind === "ai_call";
  const status = !inbound ? STATUS_LABEL[activity.status] : undefined;
  const author = inbound ? leadName : `${activity.actor.name}${activity.actor.kind === "agent" ? " (agent)" : ""}`;
  return (
    <li className={cn("flex motion-safe:animate-msg-in", inbound ? "justify-start" : "justify-end")}>
      <article aria-label={`${KIND_LABEL[activity.kind]} ${inbound ? "from" : "to"} ${leadName}`}
        className={cn("min-w-0 max-w-[88%] rounded-2xl border px-3 py-2",
          inbound ? "rounded-bl-md border-hairline/50 bg-panel" : "rounded-br-md border-accent/20 bg-accent/[0.08]",
          activity.status === "pending" && "border-dashed border-accent/60", activity.status === "failed" && "border-danger/40")}>
        <header className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11.5px] text-ink-tertiary">
          <span className="flex items-center gap-1 text-ink-secondary">{KIND_ICON[activity.kind]}{call && inbound ? "Called in" : KIND_LABEL[activity.kind]}</span>
          <span>· {author} · {when(activity.createdAt)}</span>
          {status && <span className={cn("rounded-full px-1.5 py-px text-[11px]", statusTone(activity.status))}>{status}</span>}
        </header>
        {actions.draft ? <DraftFields activity={activity} actions={actions} /> : <>
          {activity.subject && <p className="mt-1 text-[13px] font-medium text-ink">{activity.subject}</p>}
          {activity.goal && <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-secondary"><span className="text-ink-tertiary">Goal: </span>{activity.goal}</p>}
          {activity.body && !(call && inbound) && <ClampedText text={activity.body} className="[&>p]:text-ink" />}
        </>}
        {activity.summary && <div className="mt-1.5 whitespace-pre-wrap rounded-lg bg-raised/50 px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-secondary">{activity.summary}</div>}
        {activity.transcript && (
          <div className="mt-1.5">
            <button type="button" className="flex items-center gap-1 text-[12px] text-ink-tertiary hover:text-ink" aria-expanded={transcript} onClick={() => setTranscript((open) => !open)}>
              <ChevronDown size={12} className={cn("transition-transform duration-(--motion-fast)", transcript && "rotate-180")} />Transcript
            </button>
            {transcript && <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap font-sans text-[12px] leading-relaxed text-ink-secondary">{activity.transcript}</pre>}
          </div>
        )}
        {activity.error && <p className="mt-1 text-[12px] text-danger">{activity.error}</p>}
        {canEdit && hasControls(activity) && <ActivityControls activity={activity} actions={actions} />}
      </article>
    </li>
  );
}

function ReplyBox({ projectId, projectName, lead, activities, chief, channels }: {
  projectId: string; projectName: string; lead: PipelineLead; activities: readonly PipelineActivity[]; chief: Bot; channels: Record<PipelineChannel, boolean> | null;
}) {
  const templates = useCloudQuery<SalesTemplate[]>("pipelineInbox:templates", { projectId });
  const [channel, setChannel] = useState<SalesReplyChannel | null>(() => replyChannelFor(lead, activities));
  const [subject, setSubject] = useState(() => replySubject(activities));
  const [body, setBody] = useState("");
  const [managing, setManaging] = useState(false);
  const [info, setInfo] = useState("");
  const action = useAction();
  const suggesting = useAction();
  const reachable = (value: SalesReplyChannel) => Boolean(value === "email" ? lead.email : lead.phone);
  const blocked = !channel ? `Add an email address or a phone number to write to ${lead.name}.`
    : channels && !channels[channel] ? `Connect ${PROVIDER[channel]} under Settings > Integrations first; the keys stay on this computer.` : "";
  const ready = channel && !blocked && body.trim() && (channel !== "email" || subject.trim());
  const usable = (templates ?? []).filter((row) => !row.channel || row.channel === channel);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!ready || action.busy || !channel) return;
    setInfo("");
    const ok = await action.run(async () => {
      const { activityId } = await cloudMutation<{ activityId: string }>("pipeline:draftContact", { projectId, leadId: lead._id, channel, ...(channel === "email" ? { subject } : {}), body });
      setInfo((await pipelineServer.send({ projectId, activityId, botId: chief.id })).message);
    }, "Could not send the reply");
    if (ok) setBody("");
  };
  const suggest = () => {
    if (!channel) return;
    void suggesting.run(async () => {
      const reply = await pipelineServer.suggest({ projectId, leadId: lead._id, channel, botId: chief.id, projectName });
      setBody(reply.body);
      if (reply.subject && channel === "email" && !subject.trim()) setSubject(reply.subject);
    }, "Could not suggest a reply");
  };
  const insert = (id: string) => {
    if (id === "manage") { setManaging(true); return; }
    const template = usable.find((row) => row._id === id);
    if (!template) return;
    setBody(fillLeadTemplate(template.body, lead));
    if (template.subject && channel === "email") setSubject(fillLeadTemplate(template.subject, lead));
  };

  return (<>
    <form onSubmit={submit} aria-label="Reply" className="flex flex-col gap-2 rounded-2xl border border-hairline/50 bg-panel p-2.5"
      onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void submit(event); }}>
      <div className="flex flex-wrap items-center gap-1">
        {(["email", "sms", "whatsapp"] as const).map((value) => (
          <button key={value} type="button" aria-pressed={channel === value} disabled={!reachable(value)} onClick={() => setChannel(value)}
            title={reachable(value) ? `Reply by ${REPLY_LABEL[value]}` : value === "email" ? "No email address" : "No phone number"}
            className={cn("flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-secondary transition-colors hover:bg-raised/60 hover:text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40 disabled:hover:bg-transparent",
              channel === value && "bg-raised text-ink")}>
            {KIND_ICON[value]}{REPLY_LABEL[value]}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Select size="sm" aria-label="Insert a template" value="" onChange={(event) => insert(event.target.value)}>
            <option value="">Templates</option>
            {usable.map((row) => <option key={row._id} value={row._id}>{row.name}</option>)}
            <option value="manage">Manage templates…</option>
          </Select>
          <button type="button" className={cn(ghostButton, "h-8 rounded-full px-2.5")} disabled={!channel || suggesting.busy} onClick={suggest} title={`${chief.name}'s quick model drafts a reply in your brand voice`}>
            {suggesting.busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}Suggest
          </button>
        </div>
      </div>
      {channel === "email" && <input className={inputClass} aria-label="Subject" placeholder={`Subject · to ${lead.email}`} value={subject} maxLength={300} onChange={(event) => setSubject(event.target.value)} />}
      <textarea className={cn(inputClass, "min-h-[84px] resize-y")} aria-label="Reply" value={body} maxLength={channel === "sms" ? 1600 : 20000}
        placeholder={channel ? `${REPLY_LABEL[channel]} to ${channel === "email" ? lead.email : lead.phone}` : "No way to reach them yet"} onChange={(event) => setBody(event.target.value)} />
      {blocked && <p className="text-[12px] text-ink-tertiary">{blocked}</p>}
      {(action.error || suggesting.error) && <Notice tone="danger">{action.error || suggesting.error}</Notice>}
      {info && <Notice>{info}</Notice>}
      <div className="flex items-center gap-2">
        {channel === "sms" && <span className="text-[11.5px] tabular-nums text-ink-tertiary">{body.length} characters</span>}
        <span className="text-[11.5px] text-ink-tertiary max-sm:hidden">Ctrl+Enter</span>
        <button className={cn(primaryButton, "ml-auto h-8 rounded-full px-4")} disabled={!ready || action.busy}>
          {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send
        </button>
      </div>
    </form>
    {managing && <TemplatesDialog projectId={projectId} templates={templates ?? []} onClose={() => setManaging(false)} />}
  </>);
}
