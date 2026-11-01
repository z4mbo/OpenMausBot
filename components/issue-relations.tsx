"use client";
import { errorText } from "@/lib/error-text";
import { useState } from "react";
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
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (error) { setError(errorText(error, "Could not update issue")); } finally { setBusy(false); } };
  const relations = data?.relations || [];
  if (!canEdit && !relations.length) return null;
  return <section className="issue-relations" aria-label="Related issues">
    {!!relations.length && <div className="related-issue-list">{relations.map(row => <div key={row._id}>
      <small>{row.kind === "parent" ? row.outgoing ? "Sub-issue" : "Parent" : row.outgoing ? "Blocks" : "Blocked by"}</small>
      <button type="button" onClick={() => onOpen(row.projectId, row.taskId)}>{row.done ? <CheckCircle2 size={14} className="done" /> : <Circle size={14} />}<span>{row.title}</span></button>
      {canEdit && <button type="button" className="icon-button" aria-label={`Unlink ${row.title}`} title="Unlink" disabled={busy} onClick={() => attempt(() => disconnect({ sessionToken, id: row._id }))}><X size={13} /></button>}
    </div>)}</div>}
    {canEdit && !linking && <button type="button" className="issue-add-row" onClick={() => setLinking(true)}><Link2 size={14} />Link issue</button>}
    {linking && <div className="relation-picker" onKeyDown={event => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); setLinking(false); } }}>
      <div className="relation-picker-head"><IssueSelect label="Relationship" value={kind} onChange={setKind} options={RELATION_KINDS} /><button type="button" className="icon-button" aria-label="Cancel linking" onClick={() => setLinking(false)}><X size={14} /></button></div>
      <FeatureIssuePicker sessionToken={sessionToken} exclude={taskId} selected={relations.map(row => row.taskId)} onSelect={other => { if (!busy) void attempt(async () => { const reverse = kind === "blocked" || kind === "child"; await connect({ sessionToken, fromTaskId: reverse ? other : taskId, toTaskId: reverse ? taskId : other, kind: kind === "parent" || kind === "child" ? "parent" : "blocks" }); setLinking(false); }); }} />
    </div>}
    {error && <p className="issue-field-error" role="alert">{error}</p>}
  </section>;
}

export function IssueLabels({ sessionToken, taskId, canEdit }: { sessionToken: string; taskId: Id<"tasks">; canEdit: boolean }) {
  const data = useQuery(api.issueRelations.list, { sessionToken, taskId });
  const labels = useMutation(api.issueRelations.labels);
  const [label, setLabel] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (error) { setError(errorText(error, "Could not update labels")); } finally { setBusy(false); } };
  const add = () => { const value = label.trim(); if (!value) return; if (data?.labels.includes(value)) { setLabel(""); return; } void attempt(async () => { await labels({ sessionToken, taskId, labels: [...(data?.labels || []), value] }); setLabel(""); }); };
  return <div className="issue-labels-field">
    <div className="issue-labels">
      {data?.labels.map(value => <span key={value}>{value}{canEdit && <button type="button" disabled={busy} aria-label={`Remove label ${value}`} onClick={() => attempt(() => labels({ sessionToken, taskId, labels: data.labels.filter(item => item !== value) }))}><X size={11} /></button>}</span>)}
      {canEdit && <label className="issue-label-add"><Plus size={13} aria-hidden="true" /><input aria-label="New label" placeholder="Label" maxLength={32} value={label} disabled={busy} onChange={event => setLabel(event.target.value)} onKeyDown={event => {
        if (event.key === "Enter") { event.preventDefault(); add(); }
        else if (event.key === "Escape" && label) { event.preventDefault(); event.stopPropagation(); setLabel(""); }
      }} onBlur={() => { if (label.trim()) add(); }} /></label>}
      {!canEdit && !data?.labels.length && <span className="issue-empty-value">None</span>}
    </div>
    {error && <small className="issue-field-error" role="alert">{error}</small>}
  </div>;
}
