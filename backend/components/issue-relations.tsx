"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CheckCircle2, Circle, Link2, Plus, Tag, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { FeatureIssuePicker } from "./feature-issue-picker";

export function IssueRelations({ sessionToken, taskId, canEdit, onOpen }: { sessionToken: string; taskId: Id<"tasks">; canEdit: boolean; onOpen: (projectId: Id<"projects">, taskId: Id<"tasks">) => void }) {
  const data = useQuery(api.issueRelations.list, { sessionToken, taskId });
  const connect = useMutation(api.issueRelations.connect), disconnect = useMutation(api.issueRelations.disconnect), labels = useMutation(api.issueRelations.labels);
  const [label, setLabel] = useState(""); const [linking, setLinking] = useState(false); const [kind, setKind] = useState("blocks"); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const attempt = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (error) { setError(error instanceof Error ? error.message : "Could not update issue"); } finally { setBusy(false); } };
  return <section className="issue-relations" aria-label="Labels and related issues">
    <div className="issue-labels"><Tag size={14} />{data?.labels.map(value => <span key={value}>{value}{canEdit && <button disabled={busy} className="icon-button" aria-label={`Remove label ${value}`} title="Remove label" onClick={() => attempt(() => labels({ sessionToken, taskId, labels: data.labels.filter(item => item !== value) }))}><X size={11} /></button>}</span>)}{canEdit && <form onSubmit={event => { event.preventDefault(); if (label.trim()) void attempt(async () => { await labels({ sessionToken, taskId, labels: [...(data?.labels || []), label] }); setLabel(""); }); }}><input aria-label="New label" placeholder="Add label" maxLength={32} value={label} onChange={e => setLabel(e.target.value)} /><button className="icon-button" aria-label="Add label" title="Add label" disabled={busy || !label.trim()}><Plus size={13} /></button></form>}</div>
    {!!data?.relations.length && <div className="related-issue-list">{data.relations.map(row => <div key={row._id}><small>{row.kind === "parent" ? row.outgoing ? "Sub-issue" : "Parent" : row.outgoing ? "Blocks" : "Blocked by"}</small><button onClick={() => onOpen(row.projectId, row.taskId)}>{row.done ? <CheckCircle2 size={14} /> : <Circle size={14} />}<span>{row.title}</span></button>{canEdit && <button className="icon-button" aria-label={`Unlink ${row.title}`} title="Unlink issue" disabled={busy} onClick={() => attempt(() => disconnect({ sessionToken, id: row._id }))}><X size={13} /></button>}</div>)}</div>}
    {canEdit && <button className="ghost-button compact" onClick={() => setLinking(!linking)} aria-expanded={linking}><Link2 size={13} />Link issue</button>}
    {linking && <div className="relation-picker"><select aria-label="Relationship" value={kind} onChange={e => setKind(e.target.value)}><option value="blocks">Blocks</option><option value="blocked">Blocked by</option><option value="parent">Sub-issue</option><option value="child">Parent issue</option></select><FeatureIssuePicker sessionToken={sessionToken} selected={data?.relations.map(row => row.taskId) || []} onSelect={other => { if (!busy) void attempt(async () => { const reverse = kind === "blocked" || kind === "child"; await connect({ sessionToken, fromTaskId: reverse ? other : taskId, toTaskId: reverse ? taskId : other, kind: kind === "parent" || kind === "child" ? "parent" : "blocks" }); setLinking(false); }); }} /></div>}
    {error && <p className="notice danger" role="alert">{error}</p>}
  </section>;
}
