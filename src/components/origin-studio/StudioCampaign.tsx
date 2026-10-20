import { useState } from "react";
import { AudioLines, Check, Clapperboard, Image as ImageIcon, Loader2, Megaphone, Send, Square, Workflow, X } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { Field, Modal, Notice, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { MediaThumb, studioPost } from "./studio-ui";
import type { StudioCharacter } from "../../../shared/studio";
import { CAMPAIGN_PACK_ID, studioWorkflowTemplate, type StudioRunNode, type StudioWorkflowRun } from "../../../shared/studio-workflow";

/** The pack's Output nodes, in the order the strip shows them. */
const PIECES: readonly { nodeId: string; label: string; box: readonly [number, number]; icon: typeof ImageIcon }[] = [
  { nodeId: "o1", label: "Hero", box: [56, 32], icon: ImageIcon },
  { nodeId: "o2", label: "Square post", box: [40, 40], icon: ImageIcon },
  { nodeId: "o3", label: "Reel", box: [30, 52], icon: Clapperboard },
  { nodeId: "o4", label: "Voice-over", box: [40, 40], icon: AudioLines },
];

/** Whether a run is a Campaign pack: its graph has every Output node the pack defines, with the same names. */
export function isCampaignRun(run: StudioWorkflowRun): boolean {
  const template = studioWorkflowTemplate(CAMPAIGN_PACK_ID)!;
  return template.graph.nodes.filter((node) => node.type === "output").every((output) =>
    run.graph.nodes.some((node) => node.id === output.id && node.type === "output" && node.params.name === output.params.name));
}

/** One brief in; the pack runs as a workflow whose feed post and reel land as Broadcast drafts. */
export function CampaignDialog({ projectId, falReady, onStarted, onClose }: {
  projectId: string; falReady: boolean | null; onStarted(runId: string): void; onClose(): void;
}) {
  const library = useCloudQuery<StudioCharacter[]>("studioLibrary:list", { projectId });
  const [brief, setBrief] = useState("");
  const [script, setScript] = useState("");
  const [caption, setCaption] = useState("");
  const [characterId, setCharacterId] = useState("");
  const action = useAction();
  const ready = Boolean(brief.trim()) && falReady === true;
  const start = () => {
    if (!ready || action.busy) return;
    void action.run(async () => {
      const { runId } = await studioPost<{ runId: string }>("campaign", { projectId, brief, ...(script.trim() ? { script } : {}), ...(caption.trim() ? { caption } : {}), ...(characterId ? { characterId } : {}) });
      onStarted(runId);
      onClose();
    }, "Could not start the campaign pack");
  };
  return (
    <Modal title="Campaign pack" onClose={onClose}>
      <div className="flex flex-col gap-3" data-campaign-dialog onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); start(); } }}>
        <div className="grid grid-cols-4 gap-2" aria-hidden="true">
          {PIECES.map((piece) => (
            <div key={piece.nodeId} className="flex flex-col items-center gap-1.5">
              <span className="flex h-14 w-full items-end justify-center">
                <span className={cn("flex items-center justify-center border border-hairline/60 bg-inset text-ink-tertiary", piece.icon === AudioLines ? "rounded-full" : "rounded-md")} style={{ width: piece.box[0], height: piece.box[1] }}>
                  <piece.icon size={13} />
                </span>
              </span>
              <span className="text-[11px] text-ink-tertiary">{piece.label}</span>
            </div>
          ))}
        </div>
        <Field label="Brief">
          <textarea autoFocus className={cn(inputClass, "resize-none")} rows={3} maxLength={4_000} value={brief} onChange={(event) => setBrief(event.target.value)} aria-label="Brief"
            placeholder="What you launch, who it is for, the mood" />
        </Field>
        <Field label="Voice-over">
          <textarea className={cn(inputClass, "resize-none")} rows={2} maxLength={2_000} value={script} onChange={(event) => setScript(event.target.value)} aria-label="Voice-over script" placeholder="Written from the brief" />
        </Field>
        <Field label="Post caption">
          <input className={inputClass} maxLength={2_000} value={caption} onChange={(event) => setCaption(event.target.value)} aria-label="Post caption" placeholder="Written from the brief" />
        </Field>
        {library && library.length > 0 && (
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Follow from the library">
            <span className="text-[12px] font-medium text-ink-secondary">Keep consistent</span>
            <div className="flex flex-wrap gap-1.5">
              {[{ _id: "", name: "Nothing", references: [] as StudioCharacter["references"] }, ...library].map((entry) => (
                <button key={entry._id || "none"} type="button" role="radio" aria-checked={characterId === entry._id} onClick={() => setCharacterId(entry._id)}
                  className={cn("flex h-8 items-center gap-1.5 rounded-full border pl-1 pr-3 text-[12.5px] transition-colors duration-(--motion-fast) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    characterId === entry._id ? "border-accent/60 bg-raised text-ink" : "border-hairline/60 text-ink-secondary hover:text-ink", !entry._id && "pl-3")}>
                  {entry._id && <MediaThumb kind="image" url={entry.references[0]?.url ?? undefined} className="size-6 rounded-full" />}{entry.name}
                </button>
              ))}
            </div>
          </div>
        )}
        {action.error && <Notice tone="danger">{action.error}</Notice>}
        <div className="flex items-center justify-end gap-2">
          {falReady === false && <span className="mr-auto text-[12px] text-ink-tertiary">Add a fal.ai key to generate</span>}
          <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
          <button type="button" className={primaryButton} disabled={!ready || action.busy} onClick={start} title="Generate pack (Ctrl+Enter)">
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Megaphone size={14} />}Generate pack
          </button>
        </div>
      </div>
    </Modal>
  );
}

function Piece({ piece, state, live }: { piece: (typeof PIECES)[number]; state?: StudioRunNode; live: boolean }) {
  const output = state?.output;
  const working = live && state?.status !== "done" && state?.status !== "failed";
  return (
    <figure className="flex min-w-0 flex-col gap-1.5" data-campaign-piece={piece.label}>
      <div className="relative flex h-28 items-center justify-center overflow-hidden rounded-lg bg-inset">
        {output && output.kind !== "audio" ? <MediaThumb kind={output.kind} url={output.url} className="size-full" alt={piece.label} />
          : output ? <AudioLines size={18} className="text-accent-text" aria-hidden="true" />
            : <piece.icon size={16} className="text-ink-tertiary" aria-hidden="true" />}
        {working && <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-transparent via-raised/50 to-transparent [background-size:200%_100%] motion-safe:animate-shimmer" />}
      </div>
      <figcaption className="flex items-center gap-1 text-[11.5px] text-ink-secondary">
        {state?.status === "done" ? <Check size={11} className="text-success" aria-hidden="true" /> : working ? <Loader2 size={11} className="animate-spin text-ink-tertiary" aria-hidden="true" /> : null}
        <span className="truncate">{piece.label}</span>
      </figcaption>
    </figure>
  );
}

/** The newest Campaign pack's four pieces as they finish, with its Broadcast drafts once it is done. */
export function CampaignStrip({ run, onOpenRun, onOpenBroadcast, onStop, onDismiss }: {
  run: StudioWorkflowRun; onOpenRun(): void; onOpenBroadcast(): void; onStop(): void; onDismiss(): void;
}) {
  const states = new Map(run.nodes.map((node) => [node.nodeId, node]));
  const live = run.status === "running";
  const done = run.nodes.filter((node) => node.status === "done").length;
  const brief = String(run.graph.nodes.find((node) => node.id === "p1")?.params.text ?? "");
  return (
    <section aria-label="Campaign pack" className="mb-3 rounded-xl border border-hairline/40 bg-panel p-3 motion-safe:animate-pop-in" data-campaign-run={run.status}>
      <div className="mb-2.5 flex items-center gap-2">
        <Megaphone size={14} className="shrink-0 text-accent-text" aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-[13px] text-ink"><span className="font-medium">Campaign pack</span><span className="text-ink-tertiary"> · {brief}</span></p>
        <span className={cn("shrink-0 text-[12px] tabular-nums", run.status === "failed" ? "text-danger" : "text-ink-tertiary")} role="status">
          {live ? `${done} of ${run.nodes.length}` : run.status === "done" ? "Ready" : run.status === "failed" ? "Failed" : "Stopped"}
        </span>
        <button type="button" className={cn(iconButton, "size-7")} onClick={onOpenRun} aria-label="Open its workflow" title="Open its workflow"><Workflow size={13} /></button>
        {live
          ? <button type="button" className={cn(iconButton, "size-7")} onClick={onStop} aria-label="Stop the pack" title="Stop"><Square size={12} /></button>
          : <button type="button" className={cn(iconButton, "size-7")} onClick={onDismiss} aria-label="Hide" title="Hide"><X size={13} /></button>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PIECES.map((piece) => <Piece key={piece.nodeId} piece={piece} state={states.get(piece.nodeId)} live={live} />)}
      </div>
      {(run.posts?.length ?? 0) > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-hairline/30 pt-2.5 text-[12.5px] text-ink-secondary">
          <Send size={13} className="text-accent-text" aria-hidden="true" />
          <span>{run.posts!.map((post) => (post.group === "reel" ? "Reel" : "Feed post")).join(" and ")} drafted{run.agentName ? ", waiting for approval" : ""}</span>
          <button type="button" className={cn(ghostButton, "ml-auto h-7 min-h-7 px-2.5 text-[12px]")} onClick={onOpenBroadcast}>Open Broadcast</button>
        </div>
      )}
    </section>
  );
}
