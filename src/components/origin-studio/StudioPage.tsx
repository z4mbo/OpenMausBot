import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, AudioLines, Check, ExternalLink, FolderDown, Loader2, RotateCcw, Send, Sparkles, Trash2 } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { relativeTime } from "@/lib/memory";
import { cn } from "@/lib/cn";
import { CloudGate, EmptyState, Loading, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, cardClass, iconButton, pageClass, type OriginPageProps } from "../origin-pages/ui";
import { StudioComposer, type StudioDraft } from "./StudioComposer";
import type { StudioGeneration, StudioMediaKind } from "../../../shared/studio";

type Filter = "all" | StudioMediaKind;

export function StudioPage({ agent: _agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Studio">{({ projectId, canEdit, isAdmin }) => <Studio projectId={projectId} canEdit={canEdit} isAdmin={isAdmin} />}</CloudGate>;
}

/** Whether this app holds a fal key, read again whenever settings close or the window regains focus. */
function useFalReady(): boolean | null {
  const { state } = useStore();
  const [ready, setReady] = useState<boolean | null>(null);
  const check = useCallback(() => {
    api<{ fal: boolean }>("/api/studio/status").then((body) => setReady(body.fal), () => setReady(null));
  }, []);
  useEffect(() => {
    if (!state.appSettingsOpen) check();
  }, [state.appSettingsOpen, check]);
  useEffect(() => {
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [check]);
  return ready;
}

function Studio({ projectId, canEdit, isAdmin }: { projectId: string; canEdit: boolean; isAdmin: boolean }) {
  const rows = useCloudQuery<StudioGeneration[]>("studio:list", { projectId });
  const falReady = useFalReady();
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const shown = rows?.filter((row) => filter === "all" || row.kind === filter) ?? [];
  return (
    <section className={pageClass} aria-label="Studio">
      <PageHeader title="Studio" count={rows?.length}>
        <Segmented label="Show" value={filter} onChange={setFilter}
          options={[{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }]} />
      </PageHeader>
      {!canEdit && <div className="mb-3"><ReadOnlyEditorNotice canEdit={canEdit} /></div>}
      <StudioComposer projectId={projectId} canEdit={canEdit} falReady={falReady} draft={draft} />
      {!rows ? <Loading label="Loading generations" variant="grid" /> : !shown.length ? (
        <EmptyState compact icon={<Sparkles size={22} />} title={filter === "all" ? "Nothing generated yet" : "Nothing here yet"}
          body={filter === "all" ? "What you and the project's agents make appears here for the whole team." : undefined} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3" data-studio-gallery>
          {shown.map((row) => (
            <GenerationCard key={row._id} row={row} projectId={projectId} canEdit={canEdit} isAdmin={isAdmin}
              onReuse={() => setDraft({ mode: row.mode, model: row.model, prompt: row.prompt, ...(row.aspectRatio ? { aspectRatio: row.aspectRatio } : {}), ...(row.duration ? { duration: row.duration } : {}), ...(row.sourceAssetId ? { sourceAssetId: row.sourceAssetId } : {}) })} />
          ))}
        </div>
      )}
    </section>
  );
}

function ratioOf(row: StudioGeneration): string {
  const match = /^(\d+):(\d+)$/.exec(row.aspectRatio ?? "");
  if (match) return `${match[1]} / ${match[2]}`;
  return row.kind === "video" ? "16 / 9" : "1 / 1";
}

function useElapsed(since: number, live: boolean): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [live]);
  const seconds = Math.max(0, Math.round((now - since) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function GenerationCard({ row, projectId, canEdit, isAdmin, onReuse }: { row: StudioGeneration; projectId: string; canEdit: boolean; isAdmin: boolean; onReuse(): void }) {
  const live = row.status === "queued" || row.status === "running";
  const elapsed = useElapsed(row.startedAt ?? row.createdAt, live);
  const [busy, setBusy] = useState<"save" | "broadcast" | "delete" | null>(null);
  const [error, setError] = useState("");
  const output = row.outputs[0];
  const saved = row.saved.some((entry) => entry.index === 0);
  const picked = row.broadcast.some((entry) => entry.index === 0);
  const run = async (kind: "save" | "broadcast" | "delete", task: () => Promise<unknown>) => {
    setBusy(kind);
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };
  const save = () => run("save", () => api("/api/studio/save-asset", { method: "POST", body: JSON.stringify({ projectId, generationId: row._id, index: 0 }) }));
  const broadcast = () => run("broadcast", () => api("/api/studio/broadcast", { method: "POST", body: JSON.stringify({ projectId, generationId: row._id, index: 0, picked: !picked }) }));
  const remove = () => {
    if (!window.confirm("Delete this generation? Saved assets stay in Assets.")) return;
    void run("delete", () => cloudMutation("studio:remove", { projectId, generationId: row._id }));
  };
  return (
    <article className={cn(cardClass, "flex flex-col overflow-hidden motion-safe:animate-pop-in")} data-studio-generation={row.status}>
      <div className={cn("relative flex items-center justify-center overflow-hidden bg-inset", row.kind === "audio" && "!aspect-auto min-h-[112px]")} style={{ aspectRatio: ratioOf(row) }}>
        {live && (
          <div className="flex flex-col items-center gap-2 text-[12.5px] text-ink-secondary" role="status">
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-transparent via-raised/40 to-transparent [background-size:200%_100%] motion-safe:animate-shimmer" />
            <Loader2 size={18} className="animate-spin text-accent-text" />
            <span className="relative">{row.status === "queued" ? "Queued" : "Generating"} · {elapsed}</span>
          </div>
        )}
        {row.status === "failed" && (
          <div className="flex flex-col items-center gap-1.5 px-4 text-center text-[12.5px] text-danger" role="alert">
            <AlertTriangle size={18} />
            <span className="line-clamp-4">{row.error ?? "The generation failed"}</span>
          </div>
        )}
        {row.status === "done" && output && (
          output.kind === "image" ? <img src={output.url} alt={row.prompt} loading="lazy" className="size-full object-cover" />
            : output.kind === "video" ? <video src={output.url} controls loop muted playsInline preload="metadata" className="size-full object-cover" />
              : (
                <div className="flex w-full flex-col items-center gap-3 px-3 py-4">
                  <AudioLines size={22} className="text-accent-text" aria-hidden="true" />
                  <audio src={output.url} controls preload="none" className="h-9 w-full" />
                </div>
              )
        )}
        {row.outputs.length > 1 && <span className="absolute right-2 top-2 rounded-full bg-app/80 px-2 py-0.5 text-[11px] text-ink-secondary">+{row.outputs.length - 1}</span>}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <p className="line-clamp-2 text-[12.5px] leading-snug text-ink" title={row.prompt}>{row.prompt || <span className="text-ink-tertiary">No prompt</span>}</p>
        <p className="truncate text-[11.5px] text-ink-tertiary">{row.modelLabel} · {row.agentName ?? row.createdByName} · {relativeTime(row.createdAt)}</p>
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="mt-auto flex items-center gap-0.5 pt-1">
          {row.status === "done" && canEdit && (
            <>
              {saved ? (
                <span className="inline-flex h-8 items-center gap-1.5 px-2 text-[12px] text-success" title="Saved to Assets"><Check size={13} />Saved</span>
              ) : (
                <button type="button" className={cn(iconButton, "w-auto gap-1.5 px-2 text-[12px]")} disabled={busy !== null} onClick={() => void save()} title="Save to Assets">
                  {busy === "save" ? <Loader2 size={13} className="animate-spin" /> : <FolderDown size={13} />}Save
                </button>
              )}
              <button type="button" className={cn(iconButton, "w-auto gap-1.5 px-2 text-[12px]", picked && "text-accent-text")} disabled={busy !== null} onClick={() => void broadcast()}
                aria-pressed={picked} title={picked ? "Remove from Broadcast" : "Use in Broadcast"}>
                {busy === "broadcast" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}{picked ? "In Broadcast" : "Broadcast"}
              </button>
            </>
          )}
          <span className="flex-1" />
          {canEdit && <button type="button" className={iconButton} onClick={onReuse} title="Reuse prompt" aria-label="Reuse prompt"><RotateCcw size={13} /></button>}
          {output && <a className={iconButton} href={output.url} target="_blank" rel="noreferrer" title="Open" aria-label="Open the output"><ExternalLink size={13} /></a>}
          {(canEdit || isAdmin) && <button type="button" className={iconButton} disabled={busy !== null} onClick={remove} title="Delete" aria-label="Delete generation"><Trash2 size={13} /></button>}
        </div>
      </div>
    </article>
  );
}
