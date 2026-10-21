import { useState, type FormEvent } from "react";
import { History, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { decodeScene, type CanvasNode } from "../../../../shared/canvas-scene";
import { cloudMutation, cloudQueryOnce, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import type { CanvasScene } from "./use-canvas-scene";

type Version = { _id: string; name: string; nodeCount: number; authorName: string; agentName?: string; createdAt: number };

/** The changes that bring the scene back to a saved version: its nodes as they were, anything added since deleted. */
export function restoreChanges(current: ReadonlyMap<string, CanvasNode>, saved: readonly CanvasNode[]): CanvasNode[] {
  const wanted = new Map(saved.filter((node) => !node.deleted).map((node) => [node.id, node]));
  const out: CanvasNode[] = [];
  for (const node of current.values()) if (!node.deleted && !wanted.has(node.id)) out.push({ ...node, deleted: true });
  for (const node of wanted.values()) {
    const now = current.get(node.id);
    const { version: _version, versionNonce: _nonce, ...rest } = node;
    out.push({ ...rest, version: now?.version ?? 1, versionNonce: now?.versionNonce ?? 0 });
  }
  return out;
}

/** Named snapshots of the canvas: save one, restore one (undoable), delete one. */
export function VersionsPanel({ canvas, scope, readOnly, notify }: { canvas: CanvasScene; scope: { teamId: string; canvasId: string }; readOnly: boolean; notify(message: string): void }) {
  const versions = useCloudQuery<Version[]>("canvasCollab:versions", scope);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    setBusy("save");
    try { await cloudMutation("canvasCollab:saveVersion", { ...scope, name: name.trim() }); setName(""); } catch (error) { notify(error instanceof Error ? error.message : "Could not save the version"); } finally { setBusy(null); }
  };
  const restore = async (version: Version) => {
    setBusy(version._id);
    setConfirm(null);
    try {
      const rows = await cloudQueryOnce<string[]>("canvasCollab:versionRows", { ...scope, versionId: version._id });
      canvas.commit(restoreChanges(canvas.scene, decodeScene(rows ?? [])));
      setStatus(`Restored ${version.name}. Undo brings the canvas back.`);
    } catch (error) { notify(error instanceof Error ? error.message : "Could not restore the version"); } finally { setBusy(null); }
  };
  const remove = async (version: Version) => {
    setBusy(version._id);
    try { await cloudMutation("canvasCollab:deleteVersion", { ...scope, versionId: version._id }); } catch (error) { notify(error instanceof Error ? error.message : "Could not delete the version"); } finally { setBusy(null); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline/40 px-3 text-[12.5px] font-medium text-ink"><History size={14} className="text-ink-tertiary" />Version history</div>
      {!readOnly && (
        <form onSubmit={(event) => void save(event)} className="flex gap-1.5 border-b border-hairline/40 p-2.5">
          <input aria-label="Version name" placeholder="Name this version" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => event.stopPropagation()}
            className="h-8 min-w-0 flex-1 rounded-md bg-inset px-2 text-[12.5px] text-ink outline-none placeholder:text-ink-tertiary focus:ring-2 focus:ring-accent/50" />
          <button disabled={!name.trim() || busy !== null} className="h-8 shrink-0 rounded-md bg-accent px-3 text-[12px] font-medium text-accent-ink outline-none transition-opacity disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent/60">
            {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : "Save"}
          </button>
        </form>
      )}
      {status && <p role="status" className="border-b border-hairline/40 px-3 py-2 text-[12px] text-ink-secondary">{status}</p>}
      <ol className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {versions === undefined && <li className="px-2 py-2 text-[12px] text-ink-tertiary">Loading versions…</li>}
        {versions?.length === 0 && <li className="px-2 py-2 text-[12px] text-ink-tertiary">No saved versions yet.</li>}
        {versions?.map((version) => (
          <li key={version._id} className="group flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-raised/60">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-ink">{version.name}</p>
              <p className="truncate text-[11px] text-ink-tertiary">{version.agentName ?? version.authorName} · {new Date(version.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · {version.nodeCount} layers</p>
            </div>
            {!readOnly && (confirm === version._id ? (
              <button type="button" onClick={() => void restore(version)} className="h-6 rounded-md bg-accent px-2 text-[11.5px] font-medium text-accent-ink outline-none focus-visible:ring-2 focus-visible:ring-accent/60">Restore</button>
            ) : (
              <span className={cn("flex items-center", busy !== version._id && "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100")}>
                {busy === version._id ? <Loader2 size={13} className="animate-spin text-ink-tertiary" /> : (
                  <>
                    <button type="button" aria-label={`Restore ${version.name}`} title="Restore" onClick={() => setConfirm(version._id)} className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><RotateCcw size={12} /></button>
                    <button type="button" aria-label={`Delete ${version.name}`} title="Delete" onClick={() => void remove(version)} className="inline-flex size-6 items-center justify-center rounded text-ink-tertiary outline-none hover:text-danger focus-visible:ring-2 focus-visible:ring-accent/60"><Trash2 size={12} /></button>
                  </>
                )}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </div>
  );
}
