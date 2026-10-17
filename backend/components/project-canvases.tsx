"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Pencil, PenTool, Plus } from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { DrawView } from "./draw-view";
import { Dialog } from "./dialog";
import { ContentSkeleton } from "./content-skeleton";
import { useWorkspace } from "./workspace-context";

export function ProjectCanvases({ projectId, sessionToken, user, canEdit }: { projectId: Id<"projects">; sessionToken: string; user: { _id: string; name: string }; canEdit: boolean }) {
  const workspace = useWorkspace();
  const canvases = useQuery(api.draw.canvases, { projectId, sessionToken });
  const create = useMutation(api.draw.createCanvas);
  const rename = useMutation(api.draw.renameCanvas);
  const [selected, setSelected] = useState<Id<"canvases"> | null>(null);
  const [editor, setEditor] = useState<"new" | "rename" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const current = canvases?.find(canvas => canvas._id === selected) || canvases?.[0];
  const openEditor = (mode: "new" | "rename") => { setName(mode === "rename" ? current?.name || "" : ""); setError(""); setEditor(mode); };
  if (!canvases) return <ContentSkeleton kind="canvas" />;
  return <section className="project-canvases">
    <div className="canvas-toolbar">{!!canvases.length && <><select aria-label="Select canvas" value={current?._id} onChange={event => setSelected(event.target.value as Id<"canvases">)}>{canvases.map(canvas => <option key={canvas._id} value={canvas._id}>{canvas.name}</option>)}</select>{canEdit && <button className="icon-button" title="Rename canvas" aria-label="Rename canvas" onClick={() => openEditor("rename")}><Pencil size={15} /></button>}</>}{canEdit && <button className="ghost-button compact" onClick={() => openEditor("new")}><Plus size={15} />New canvas</button>}</div>
    {current ? <DrawView canvasId={current._id} sessionToken={sessionToken} user={user} readOnly={!canEdit} name={current.name} /> : <div className="work-empty"><PenTool size={24} /><strong>No canvases yet</strong>{canEdit && <button className="primary-button compact" onClick={() => openEditor("new")}><Plus size={15} />Create canvas</button>}</div>}
    {editor && <Dialog title={editor === "new" ? "New canvas" : "Rename canvas"} onClose={() => setEditor(null)}><form className="dialog-body stack-form" onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { if (editor === "new") setSelected(await create({ sessionToken, projectId, name })); else if (current) await rename({ sessionToken, teamId: workspace._id, canvasId: current._id, name }); setEditor(null); } catch (error) { setError(error instanceof Error ? error.message : "Could not save canvas"); } finally { setBusy(false); } }}><label>Name<input autoFocus value={name} onChange={event => setName(event.target.value)} required maxLength={80} /></label>{error && <p className="notice danger" role="alert">{error}</p>}<button className="primary-button compact" disabled={busy}>{busy ? "Saving..." : editor === "new" ? "Create canvas" : "Save"}</button></form></Dialog>}
  </section>;
}
