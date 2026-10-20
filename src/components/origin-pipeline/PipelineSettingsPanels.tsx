import { useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Check, Copy, KeyRound, Loader2, Lock, Plus, RotateCw, Trash2 } from "lucide-react";
import { cloudMutation } from "@/lib/origin-cloud";
import { useCopyFeedback } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { Switch } from "../SettingsPrimitives";
import { Field, Notice, cardClass, ghostButton, iconButton, inputClass as baseInput, primaryButton, useAction } from "../origin-pages/ui";
import { CLOSED_STAGES, type PipelineSettingsView } from "../../../shared/origin-pipeline";

const inputClass = cn(baseInput, "font-normal");

export function CopyBlock({ label, text, multiline = false }: { label: string; text: string; multiline?: boolean }) {
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

type StageRow = { key: string; name: string; was?: string };

export function StageEditor({ projectId, stages, counts, canEdit, onSaved }: {
  projectId: string; stages: readonly string[]; counts: ReadonlyMap<string, number>; canEdit: boolean; onSaved(): void;
}) {
  const [rows, setRows] = useState<StageRow[]>(() => stages.map((stage) => ({ key: stage, name: stage, was: stage })));
  const [moveTo, setMoveTo] = useState("");
  const action = useAction();
  const removed = stages.filter((stage) => !rows.some((row) => row.was === stage));
  const stranded = removed.reduce((sum, stage) => sum + (counts.get(stage) ?? 0), 0);
  const targets = rows.filter((row) => !CLOSED_STAGES.includes(row.name) && row.name.trim()).map((row) => row.name.trim());
  const target = targets.includes(moveTo) ? moveTo : targets[0] ?? "";
  const dirty = rows.length !== stages.length || rows.some((row, index) => row.was !== stages[index] || row.name !== stages[index]);
  const move = (index: number, by: -1 | 1) => setRows((current) => {
    const next = [...current];
    const [row] = next.splice(index, 1);
    next.splice(index + by, 0, row!);
    return next;
  });
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!dirty || action.busy) return;
    const payload = rows.map((row) => ({ name: row.name.trim(), ...(row.was ? { was: row.was } : {}) }));
    if (await action.run(() => cloudMutation("pipeline:setStages", { projectId, stages: payload, ...(stranded ? { moveTo: target } : {}) }), "Could not save the stages")) onSaved();
  };
  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <ol className={cn(cardClass, "divide-y divide-hairline/30")} aria-label="Stages">
        {rows.map((row, index) => {
          const fixed = row.was !== undefined && CLOSED_STAGES.includes(row.was);
          const count = row.was ? counts.get(row.was) ?? 0 : 0;
          return (
            <li key={row.key} className="flex items-center gap-1.5 px-2 py-1.5">
              <div className="flex flex-col">
                <button type="button" className={cn(iconButton, "size-5 rounded")} aria-label={`Move ${row.name || "stage"} up`} disabled={!canEdit || index === 0} onClick={() => move(index, -1)}><ArrowUp size={12} /></button>
                <button type="button" className={cn(iconButton, "size-5 rounded")} aria-label={`Move ${row.name || "stage"} down`} disabled={!canEdit || index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={12} /></button>
              </div>
              <input className={cn(inputClass, "h-8 flex-1")} aria-label={`Stage ${index + 1} name`} value={row.name} maxLength={40} disabled={!canEdit || fixed}
                onChange={(event) => setRows((current) => current.map((item) => (item.key === row.key ? { ...item, name: event.target.value } : item)))} />
              <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-ink-tertiary">{count ? `${count} ${count === 1 ? "lead" : "leads"}` : ""}</span>
              {fixed
                ? <span className="flex size-8 shrink-0 items-center justify-center text-ink-tertiary" title={`${row.name} closes a lead, so it stays`}><Lock size={13} aria-label={`${row.name} stays`} /></span>
                : <button type="button" className={cn(iconButton, "hover:text-danger")} aria-label={`Remove ${row.name || "stage"}`} disabled={!canEdit}
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}><Trash2 size={14} /></button>}
            </li>
          );
        })}
      </ol>
      {canEdit && (
        <button type="button" className={cn(ghostButton, "self-start")} disabled={rows.length >= 12}
          onClick={() => setRows((current) => {
            const closed = current.findIndex((row) => row.was !== undefined && CLOSED_STAGES.includes(row.was));
            const at = closed < 0 ? current.length : closed;
            return [...current.slice(0, at), { key: crypto.randomUUID(), name: "" }, ...current.slice(at)];
          })}>
          <Plus size={14} />Add stage
        </button>
      )}
      {stranded > 0 && (
        <Field label={`Move the ${stranded} ${stranded === 1 ? "lead" : "leads"} in ${removed.join(", ")} to`}>
          <Select className="w-full" value={target} onChange={(event) => setMoveTo(event.target.value)}>
            {targets.map((name) => <option key={name} value={name}>{name}</option>)}
          </Select>
        </Field>
      )}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {canEdit && (
        <div className="flex justify-end gap-2">
          <button type="button" className={ghostButton} disabled={!dirty} onClick={() => { setRows(stages.map((stage) => ({ key: stage, name: stage, was: stage }))); action.setError(""); }}>Reset</button>
          <button className={primaryButton} disabled={!dirty || action.busy || rows.some((row) => !row.name.trim())}>{action.busy && <Loader2 size={14} className="animate-spin" />}Save stages</button>
        </div>
      )}
    </form>
  );
}

export function InboundSettings({ projectId, settings, isAdmin, canEdit }: { projectId: string; settings: PipelineSettingsView; isAdmin: boolean; canEdit: boolean }) {
  const inbound = settings.inbound;
  const [authToken, setAuthToken] = useState("");
  const [replyTo, setReplyTo] = useState(inbound?.replyToEmail ?? "");
  const action = useAction();
  const configure = (patch: Record<string, unknown>, fallback: string) => action.run(() => cloudMutation("pipeline:configure", { projectId, ...patch }), fallback);
  const credentialsUrl = inbound ? inbound.brevoUrl.replace(/^https:\/\//, `https://origin:${inbound.brevoSecret}@`) : "";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <p className="flex-1 text-[13px] leading-relaxed text-ink-secondary">
          Texts, WhatsApp messages and email replies from leads land on their timeline, mark them unread and notify the lead's owner. A reply ends the lead's sequence.
        </p>
        <Switch checked={settings.inboundEnabled} aria-label="Receive replies" disabled={!isAdmin || action.busy}
          onClick={() => void configure({ inboundEnabled: !settings.inboundEnabled }, "Could not change inbound")} />
      </div>
      {!settings.inboundEnabled ? <Notice>{isAdmin ? "Turn on to get this project's webhook addresses." : "Replies are off. A project admin can turn them on."}</Notice>
        : !inbound ? <Notice>{canEdit ? "The webhook addresses appear once the backend knows its public site address." : "Only editors see the webhook addresses."}</Notice> : <>
        <section className="flex flex-col gap-2">
          <h4 className="text-[13px] font-medium text-ink">Twilio</h4>
          <CopyBlock label="Messaging webhook: paste under your number's “A message comes in” (HTTP POST)" text={inbound.twilioUrl} />
          <p className="text-[12px] leading-relaxed text-ink-tertiary">Texts and calls you send ask Twilio to report delivery here too. Twilio signs each request with your auth token, so Origin keeps it to check them.</p>
          {isAdmin ? (
            <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void configure({ twilioAuthToken: authToken }, "Could not save the auth token").then((ok) => { if (ok) setAuthToken(""); }); }}>
              <Field label={inbound.twilioSigning ? "Auth token saved; paste a new one to replace it" : "Twilio auth token"} className="flex-1">
                <span className="relative flex items-center"><KeyRound size={13} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
                  <input className={cn(inputClass, "pl-7 font-mono")} type="password" autoComplete="off" spellCheck={false} value={authToken} onChange={(event) => setAuthToken(event.target.value.trim())} placeholder={inbound.twilioSigning ? "••••••••" : "32 characters"} /></span>
              </Field>
              <button className={ghostButton} disabled={!authToken || action.busy}>Save</button>
            </form>
          ) : <p className="text-[12px] text-ink-tertiary">{inbound.twilioSigning ? "Signature checks are on." : "A project admin must add the Twilio auth token before Twilio's requests are accepted."}</p>}
        </section>
        <section className="flex flex-col gap-2">
          <h4 className="text-[13px] font-medium text-ink">Brevo</h4>
          <CopyBlock label="Inbound parsing and transactional webhook" text={inbound.brevoUrl} />
          <CopyBlock label="Secret: send it as a Bearer token" text={inbound.brevoSecret} />
          <CopyBlock label="Or the address with the secret in it, where only a URL fits" text={credentialsUrl} />
          {isAdmin && (
            <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); void configure({ replyToEmail: replyTo }, "Could not save the reply-to address"); }}>
              <Field label="Reply-to address on your Brevo inbound domain" className="flex-1">
                <input className={inputClass} type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="replies@in.yourdomain.com" />
              </Field>
              <button className={ghostButton} disabled={replyTo === (inbound.replyToEmail ?? "") || action.busy}>Save</button>
            </form>
          )}
          <p className="text-[12px] leading-relaxed text-ink-tertiary">Emails you send ask leads to reply to this address; Brevo forwards those replies here. Bounces reported to the same webhook mark the email failed.</p>
        </section>
        {isAdmin && (
          <button type="button" className={cn(ghostButton, "self-start")} disabled={action.busy}
            onClick={() => { if (window.confirm("Get new webhook addresses and a new secret? Twilio and Brevo stop reaching Origin until you paste the new ones.")) void configure({ rotateInbound: true }, "Could not rotate the addresses"); }}>
            <RotateCw size={14} />New addresses
          </button>
        )}
      </>}
      {action.error && <Notice tone="danger">{action.error}</Notice>}
    </div>
  );
}
