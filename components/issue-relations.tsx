"use client";
import { errorText } from "@/lib/error-text";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Circle, Link2, Plus, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FeatureIssuePicker } from "./feature-issue-picker";
import { IssueSelect } from "./issue-select";

const RELATION_KINDS = [
  { value: "blocks", label: "Blocks" },
  { value: "blocked", label: "Blocked by" },
  { value: "parent", label: "Sub-issue" },
  { value: "child", label: "Parent issue" },
];

/** Related issues, listed only when there are some, plus one quiet "Link issue" entry. */
export function IssueRelations({ sessionToken, taskId, canEdit, onOpen }: { sessionToken: string; taskId: Id<"tasks">; canEdit: boolean; onOpen: (projectId: Id<"projects">, taskId: Id<"tasks">) => void }) {
  const data = useQuery(api.issueRelations.list, { sessionToken, taskId });
  const connect = useMutation(api.issueRelations.connect), disconnect = useMutation(api.issueRelations.disconnect);
  const [linking, setLinking] = useState(false); const [kind, setKind] = useState("blocks"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const linkButton = useRef<HTMLButtonElement>(null), returnFocus = useRef(false), pending = useRef(false);
  // Leaving the picker (Escape, Cancel or a new link) puts focus back on "Link issue".
  const stopLinking = () => { returnFocus.current = true; setLinking(false); };
  useEffect(() => {
    if (linking || !returnFocus.current) return;
    returnFocus.current = false;
    linkButton.current?.focus({ preventScroll: true });
  }, [linking]);
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (error) { setError(errorText(error, "Could not update issue")); } finally { setBusy(false); } };
  const relations = data?.relations || [];
  if (!canEdit && !relations.length) return null;
  return <section className="issue-relations" aria-label="Related issues">
    {!!relations.length && <div className="related-issue-list">{relations.map(row => <div key={row._id}>
      <small>{row.kind === "parent" ? row.outgoing ? "Sub-issue" : "Parent" : row.outgoing ? "Blocks" : "Blocked by"}</small>
      <button type="button" onClick={() => onOpen(row.projectId, row.taskId)}>{row.done ? <CheckCircle2 size={14} className="done" /> : <Circle size={14} />}<span>{row.title}</span></button>
      {canEdit && <button type="button" className="icon-button" aria-label={`Unlink ${row.title}`} title="Unlink" disabled={busy} onClick={() => attempt(() => disconnect({ sessionToken, id: row._id }))}><X size={13} /></button>}
    </div>)}</div>}
    {canEdit && !linking && <button ref={linkButton} type="button" className="issue-add-row" onClick={() => setLinking(true)}><Link2 size={14} />Link issue</button>}
    {linking && <div className="relation-picker" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); stopLinking(); } }}>
      <div className="relation-picker-head"><IssueSelect label="Relationship" caption="Relationship" value={kind} onChange={setKind} options={RELATION_KINDS} /><button type="button" className="icon-button" aria-label="Cancel linking" onClick={stopLinking}><X size={14} /></button></div>
      <FeatureIssuePicker autoFocus sessionToken={sessionToken} exclude={taskId} selected={relations.map(row => row.taskId)} onSelect={other => {
        if (pending.current) return;
        pending.current = true;
        void attempt(async () => { const reverse = kind === "blocked" || kind === "child"; await connect({ sessionToken, fromTaskId: reverse ? other : taskId, toTaskId: reverse ? taskId : other, kind: kind === "parent" || kind === "child" ? "parent" : "blocks" }); stopLinking(); }).finally(() => { pending.current = false; });
      }} />
    </div>}
    {error && <p className="issue-field-error" role="alert">{error}</p>}
  </section>;
}

export function IssueLabels({ sessionToken, taskId, canEdit }: { sessionToken: string; taskId: Id<"tasks">; canEdit: boolean }) {
  const data = useQuery(api.issueRelations.list, { sessionToken, taskId });
  const labels = useMutation(api.issueRelations.labels);
  const [label, setLabel] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null), pending = useRef(false);
  // The input stays enabled (and focused) while a change saves; a second change waits for the first.
  const attempt = async (fn: () => Promise<unknown>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError("");
    try { await fn(); } catch (error) { setError(errorText(error, "Could not update labels")); } finally { pending.current = false; setBusy(false); }
  };
  const add = () => { const value = label.trim(); if (!value) return; if (data?.labels.includes(value)) { setLabel(""); return; } void attempt(async () => { await labels({ sessionToken, taskId, labels: [...(data?.labels || []), value] }); setLabel(""); }); };
  const remove = (value: string, hadFocus: boolean) => void attempt(async () => {
    await labels({ sessionToken, taskId, labels: (data?.labels || []).filter(item => item !== value) });
    // The removed chip took focus with it: continue in the label field.
    if (hadFocus) input.current?.focus({ preventScroll: true });
  });
  return <div className="issue-labels-field">
    <div className="issue-labels">
      {data?.labels.map(value => <span key={value}>{value}{canEdit && <button type="button" aria-disabled={busy || undefined} aria-label={`Remove label ${value}`} onClick={event => remove(value, document.activeElement === event.currentTarget)}><X size={11} /></button>}</span>)}
      {canEdit && <label className="issue-label-add"><Plus size={13} aria-hidden="true" /><input ref={input} aria-label="New label" placeholder="Label" maxLength={32} value={label} readOnly={busy} aria-busy={busy || undefined} onChange={event => setLabel(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); add(); }
        else if (event.key === "Escape" && label) { event.preventDefault(); event.stopPropagation(); setLabel(""); }
      }} onBlur={() => { if (label.trim()) add(); }} /></label>}
      {!canEdit && !data?.labels.length && <span className="issue-empty-value">None</span>}
    </div>
    {error && <small className="issue-field-error" role="alert">{error}</small>}
  </div>;
}
