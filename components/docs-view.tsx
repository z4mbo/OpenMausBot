"use client";

import * as Y from "yjs";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, Check, CirclePlus, FileText, Loader2, Plus, Search, Trash2, Undo2, Redo2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useWorkspace } from "./workspace-context";
import { Dialog } from "./dialog";
import { ContentSkeleton } from "./content-skeleton";
import { IssueComposer } from "./issue-composer";
import { documentSyncQueue } from "@/lib/document-sync";
import { RECONNECT_TO_CREATE, useWorkspaceOnline } from "./workspace-connection";


export function DocsView({ sessionToken, initialPageId, projectId, origin }: { sessionToken: string; initialPageId?: Id<"wikiPages">; projectId?: Id<"projects">; origin?: string }) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const [selected, setSelected] = useState<Id<"wikiPages"> | null>(initialPageId || null);
  const [project, setProject] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState("");
  const selectedProject = projectId || (project ? project as Id<"projects"> : undefined);
  const pages = useQuery(api.documents.list, { sessionToken, teamId: workspace._id, projectId: selectedProject });
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const rows = pages?.filter(page => `${page.title} ${page.excerpt}`.toLowerCase().includes(search.toLowerCase()));
  const editable = workspace.role !== "viewer";
  useEffect(() => { if (initialPageId) setSelected(initialPageId); }, [initialPageId]);
  return <section className={`feature-page docs-page ${selected ? "has-detail" : ""}`} aria-label="Documents">
    <div className="feature-toolbar"><label className="feature-search"><Search size={15} /><input aria-label="Search documents" placeholder="Search documents" value={search} onChange={e => setSearch(e.target.value)} /></label><select aria-label="Document project" value={selectedProject || ""} disabled={!!projectId} onChange={e => setProject(e.target.value)}>{!projectId && <option value="">All projects</option>}{projects?.map(p => <option key={p._id} value={p._id}>{p.name}</option>)}</select><button className="primary-button compact" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online || !editable || !projects?.length} onClick={() => setCreating(true)}><Plus size={15} />Document</button></div>
    {notice && <p className="notice" role="status">{notice}</p>}
    <div className="feature-split"><aside className="feature-index">{rows === undefined ? <ContentSkeleton rows={5} /> : rows.length ? rows.map(page => <button key={page._id} className={selected === page._id ? "selected" : ""} onClick={() => setSelected(page._id)}><FileText size={16} /><span><strong>{page.title}</strong><small>{projects?.find(p => p._id === page.projectId)?.name} · {new Date(page.updatedAt).toLocaleDateString()}</small></span></button>) : <div className="feature-empty"><FileText size={24} /><strong>No documents yet</strong></div>}</aside>
    {selected ? <DocumentEditor key={selected} sessionToken={sessionToken} pageId={selected} origin={origin} onBack={() => setSelected(null)} onRemoved={() => { setSelected(null); setNotice("Document deleted"); }} /> : <div className="feature-empty feature-detail"><FileText size={28} /><strong>Select a document</strong></div>}</div>
    {creating && <CreateDocument sessionToken={sessionToken} projects={projects?.filter(p => !projectId || p._id === projectId) || []} defaultProject={selectedProject || ""} onClose={() => setCreating(false)} onCreated={id => { setSelected(id); setCreating(false); }} />}
  </section>;
}

function CreateDocument({ sessionToken, projects, defaultProject, onClose, onCreated }: { sessionToken: string; projects: { _id: Id<"projects">; name: string }[]; defaultProject: string; onClose: () => void; onCreated: (id: Id<"wikiPages">) => void }) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const [project, setProject] = useState(defaultProject || projects[0]?._id || "");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<"wiki" | "process" | "decision">("wiki");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const create = useMutation(api.documents.create);
  return <Dialog title="New document" onClose={onClose}><form className="feature-form" onSubmit={async e => { e.preventDefault(); if (!online) return; setBusy(true); try { onCreated(await create({ sessionToken, teamId: workspace._id, projectId: project as Id<"projects">, title, type })); } catch (err) { setError(err instanceof Error ? err.message : "Could not create document"); } finally { setBusy(false); } }}><label>Title<input autoFocus required value={title} onChange={e => setTitle(e.target.value)} maxLength={160} /></label><label>Project<select value={project} onChange={e => setProject(e.target.value)}>{projects.map(p => <option value={p._id} key={p._id}>{p.name}</option>)}</select></label><label>Type<select value={type} onChange={e => setType(e.target.value as typeof type)}><option value="wiki">Document</option><option value="process">Process</option><option value="decision">Decision</option></select></label>{error && <p className="notice danger" role="alert">{error}</p>}<button className="primary-button compact" title={!online ? RECONNECT_TO_CREATE : undefined} disabled={!online || busy || !project}>{busy ? <Loader2 size={15} className="spin" /> : <Plus size={15} />}Create document</button></form></Dialog>;
}

function DocumentEditor({ sessionToken, pageId, origin, onBack, onRemoved }: { sessionToken: string; pageId: Id<"wikiPages">; origin?: string; onBack: () => void; onRemoved: () => void }) {
  const workspace = useWorkspace();
  const online = useWorkspaceOnline();
  const page = useQuery(api.documents.get, { sessionToken, pageId });
  const projects = useQuery(api.projects.listForUser, { sessionToken, teamId: workspace._id });
  const open = useMutation(api.documents.open);
  const applyUpdate = useMutation(api.documents.applyUpdate);
  const rename = useMutation(api.documents.rename);
  const remove = useMutation(api.wiki.remove);
  const [doc] = useState(() => new Y.Doc());
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [selectedText, setSelectedText] = useState("");
  const [draft, setDraft] = useState<{ title: string; description: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [queue] = useState(() => documentSyncQueue(`${sessionToken}:${pageId}`, async updates => {
    await applyUpdate({ sessionToken, pageId, update: new Uint8Array(Y.mergeUpdates(updates)).buffer });
  }));
  const sync = useSyncExternalStore(queue.subscribe, queue.snapshot, queue.snapshot);
  const state = sync.error ? "error" : sync.saving || sync.pending ? "saving" : "saved";
  const undo = useRef<Y.UndoManager | null>(null);
  const project = projects?.find(item => item._id === page?.projectId);
  const editable = Boolean(project && workspace.role !== "viewer" && project.memberRole !== "viewer");

  useEffect(() => { void open({ sessionToken, pageId }).catch(error => setNotice(error.message)); }, [open, pageId, sessionToken]);
  useEffect(() => { if (page) setTitle(page.title); }, [page?.title]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const text = doc.getText("content");
    const manager = new Y.UndoManager(text, { trackedOrigins: new Set(["local"]) });
    undo.current = manager;
    const observe = () => setBody(text.toString());
    const update = (bytes: Uint8Array, origin: unknown) => {
      if (origin === "remote") return;
      queue.add(bytes);
      clearTimeout(timer); timer = setTimeout(() => void queue.flush(), 300);
    };
    text.observe(observe); doc.on("update", update);
    for (const update of queue.restore()) Y.applyUpdate(doc, update, "remote");
    void queue.flush();
    return () => { clearTimeout(timer); void queue.flush(); text.unobserve(observe); doc.off("update", update); manager.destroy(); };
  }, [doc, queue]);

  useEffect(() => { if (page?.collaborationState) Y.applyUpdate(doc, new Uint8Array(page.collaborationState), "remote"); else if (page && !editable) setBody(page.content); }, [doc, page?.collaborationState, page?.content, editable]);
  const change = (next: string) => {
    const text = doc.getText("content"); const previous = text.toString();
    let prefix = 0; while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix++;
    let suffix = 0; while (suffix < previous.length - prefix && suffix < next.length - prefix && previous[previous.length - suffix - 1] === next[next.length - suffix - 1]) suffix++;
    doc.transact(() => { text.delete(prefix, previous.length - prefix - suffix); text.insert(prefix, next.slice(prefix, next.length - suffix)); }, "local");
  };
  if (page === undefined) return <div className="feature-detail"><ContentSkeleton rows={7} /></div>;
  if (page === null) return <div className="feature-empty feature-detail"><strong>Document not found</strong><button className="ghost-button" onClick={onBack}>Back</button></div>;
  return <article className="feature-detail document-editor"><div className="document-tools"><button className="icon-button" title="Back to documents" aria-label="Back to documents" onClick={onBack}><ArrowLeft size={16} /></button><span className="document-save" role="status" aria-label={state === "saved" ? "All changes saved" : state === "saving" ? "Saving changes" : "Sync failed"}>{state === "saving" ? <Loader2 className="spin" size={13} /> : state === "saved" ? <Check size={13} /> : <button onClick={() => void queue.flush()}>Retry sync</button>}</span><div className="feature-toolbar-spacer" /><button className="icon-button" aria-label="Undo" title="Undo" disabled={!editable} onClick={() => undo.current?.undo()}><Undo2 size={15} /></button><button className="icon-button" aria-label="Redo" title="Redo" disabled={!editable} onClick={() => undo.current?.redo()}><Redo2 size={15} /></button><button className="icon-button" title={!online ? RECONNECT_TO_CREATE : "Create issue from selection"} aria-label="Create issue from selection" disabled={!online || !editable || !selectedText.trim()} onClick={() => setDraft({ title: selectedText.split("\n")[0].slice(0, 250), description: `${selectedText}\n\nSource: ${origin || window.location.origin}/${workspace.slug}?view=docs&doc=${pageId}` })}><CirclePlus size={16} /></button><button className="icon-button" title="Delete document" aria-label="Delete document" disabled={!editable || state !== "saved"} onClick={async () => { if (!window.confirm(`Delete "${page.title}"? This cannot be undone.`)) return; try { await remove({ sessionToken, projectId: page.projectId, pageId }); onRemoved(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not delete"); } }}><Trash2 size={15} /></button></div>
    {(sync.error || notice) && <p className={`notice ${state === "error" ? "danger" : ""}`} role="status">{sync.error || notice}</p>}
    <input className="document-title" aria-label="Document title" value={title} disabled={!editable} maxLength={160} onChange={e => setTitle(e.target.value)} onBlur={async () => { if (title !== page.title) try { await rename({ sessionToken, pageId, title }); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not rename"); setTitle(page.title); } }} />
    <textarea className="document-content" aria-label="Document content" placeholder="Start writing..." value={body} readOnly={!editable || !page.collaborationState} maxLength={60000} onChange={e => change(e.target.value)} onSelect={e => { const target = e.currentTarget; setSelectedText(target.value.slice(target.selectionStart, target.selectionEnd)); }} onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) undo.current?.redo(); else undo.current?.undo(); } }} />
    {draft && <IssueComposer sessionToken={sessionToken} projects={projects || []} activeProjectId={page.projectId} initialDraft={draft} onClose={() => setDraft(null)} onCreated={() => setNotice("Issue created")} />}
  </article>;
}
