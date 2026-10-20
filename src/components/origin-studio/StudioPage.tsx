import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Sparkles, Workflow } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { cn } from "@/lib/cn";
import { CloudGate, EmptyState, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, pageClass, type OriginPageProps } from "../origin-pages/ui";
import { StudioCanvas, type TileAction } from "./StudioCanvas";
import { STUDIO_MODES, StudioComposer, draftForModel, emptyDraft, type StudioComposerHandle } from "./StudioComposer";
import { StudioViewer } from "./StudioViewer";
import { StudioWorkflows } from "./StudioWorkflows";
import { outputRef, studioPost, typing, type StudioDraft } from "./studio-ui";
import { STUDIO_ACTIONS, studioModel, type StudioGeneration, type StudioMediaKind } from "../../../shared/studio";

type Filter = "all" | StudioMediaKind;
type Tab = "create" | "workflows";

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

const SHORTCUTS: readonly [string, string][] = [
  ["/", "Write a prompt"], ["Ctrl Enter", "Generate"], ["Ctrl E", "Enhance the prompt"], ["1 – 4", "Image, video, audio, edit"], ["M", "Choose a model"],
  ["Arrows", "Move between results"], ["Enter", "Open a result"], ["A U R X", "Animate, upscale, remix, extend"], ["P", "Reuse its settings"], ["B", "Use in Broadcast"],
  ["W", "Workflows"], ["?", "These shortcuts"],
];

function draftFrom(row: StudioGeneration): StudioDraft {
  const model = studioModel(row.model);
  const params = row.params ?? {};
  const base = model ? draftForModel(emptyDraft(row.mode), model) : emptyDraft(row.mode);
  return {
    ...base, prompt: row.prompt, ...(row.aspectRatio ? { aspectRatio: row.aspectRatio } : {}), ...(row.duration ? { duration: row.duration } : {}),
    ...(typeof params.resolution === "string" ? { resolution: params.resolution } : {}), ...(typeof params.voice === "string" ? { voice: params.voice } : {}),
    ...(typeof params.motion === "string" ? { motion: params.motion } : {}), ...(typeof params.negativePrompt === "string" ? { negativePrompt: params.negativePrompt } : {}),
    ...(typeof params.seed === "number" ? { seed: params.seed } : {}), ...(params.sound === false ? { sound: false } : {}),
  };
}

function Studio({ projectId, canEdit, isAdmin }: { projectId: string; canEdit: boolean; isAdmin: boolean }) {
  const rows = useCloudQuery<StudioGeneration[]>("studio:list", { projectId });
  const falReady = useFalReady();
  const [tab, setTab] = useState<Tab>("create");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<StudioDraft>(() => emptyDraft());
  const [viewing, setViewing] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const composer = useRef<StudioComposerHandle>(null);
  const all = rows ?? [];
  const shown = all.filter((row) => filter === "all" || (row.outputs[0]?.kind ?? row.kind) === filter);
  const running = all.filter((row) => row.status === "queued" || row.status === "running").length;
  const viewed = viewing ? shown.find((row) => row._id === viewing) ?? null : null;

  const prepare = (next: StudioDraft) => {
    setDraft(next);
    setViewing(null);
    setTab("create");
    window.setTimeout(() => composer.current?.focus(), 0);
  };

  const run = async (row: StudioGeneration, task: () => Promise<unknown>) => {
    setBusy((current) => new Set(current).add(row._id));
    setError("");
    try {
      await task();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy((current) => { const next = new Set(current); next.delete(row._id); return next; });
    }
  };

  const act = (row: StudioGeneration, action: TileAction) => {
    const ref = outputRef(row);
    const kind = row.outputs[0]?.kind ?? row.kind;
    const parent = { generationId: row._id, action };
    switch (action) {
      case "open": setViewing(row._id); return;
      case "reuse": prepare(draftFrom(row)); return;
      case "animate": if (ref) prepare({ ...draftForModel(emptyDraft("video"), studioModel(STUDIO_ACTIONS.animate)!), sources: [ref], parent }); return;
      case "remix": if (ref) prepare({ ...draftForModel(emptyDraft("edit"), studioModel(STUDIO_ACTIONS.remix)!), prompt: row.prompt, sources: [ref], parent }); return;
      case "extend": if (ref) prepare({ ...draftForModel(emptyDraft("video"), studioModel(STUDIO_ACTIONS.extend)!), prompt: row.prompt, sources: [ref], parent }); return;
      case "upscale":
      case "removeBackground": {
        if (!ref) return;
        const model = studioModel(action === "removeBackground" ? STUDIO_ACTIONS.removeBackground : kind === "video" ? STUDIO_ACTIONS.upscaleVideo : STUDIO_ACTIONS.upscale)!;
        void run(row, () => studioPost("generate", { projectId, mode: model.mode, model: model.id, prompt: "", sources: [ref.source], parent }));
        return;
      }
      case "broadcast": {
        const picked = row.broadcast.some((entry) => entry.index === 0);
        void run(row, () => studioPost("broadcast", { projectId, generationId: row._id, index: 0, picked: !picked }));
        return;
      }
      case "cancel": void run(row, () => studioPost("cancel", { projectId, generationId: row._id })); return;
      case "delete":
        if (!window.confirm("Delete this generation? Its files stay in Assets.")) return;
        if (viewing === row._id) setViewing(null);
        void run(row, () => cloudMutation("studio:remove", { projectId, generationId: row._id }));
    }
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[data-centered-dialog]")) return;
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      if (event.key === "/" && tab === "create") { event.preventDefault(); composer.current?.focus(); }
      else if (event.key === "?") { event.preventDefault(); setHelp(true); }
      else if (event.key.toLowerCase() === "w") { event.preventDefault(); setTab((current) => (current === "create" ? "workflows" : "create")); }
      else if (tab !== "create") return;
      else if (index >= 0 && canEdit) { event.preventDefault(); setDraft((current) => draftForModel(current, studioModel(emptyDraft(STUDIO_MODES[index]!.value).model)!)); }
      else if (event.key.toLowerCase() === "m" && canEdit && !(event.target as HTMLElement | null)?.closest?.("[data-studio-tile]")) { event.preventDefault(); composer.current?.openModels(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, canEdit]);

  const moveViewer = (step: -1 | 1) => {
    const done = shown.filter((row) => row.status === "done");
    const at = done.findIndex((row) => row._id === viewing);
    const next = done[(at + step + done.length) % done.length];
    if (next) setViewing(next._id);
  };

  return (
    <section className={cn(pageClass, "pb-0")} aria-label="Studio">
      <PageHeader title="Studio" count={tab === "create" ? rows?.length : undefined}>
        <Segmented label="Studio view" value={tab} onChange={setTab}
          options={[{ value: "create", label: <><Sparkles size={13} />Create</>, title: "Create (W)" }, { value: "workflows", label: <><Workflow size={13} />Workflows</>, title: "Workflows (W)" }]} />
        {tab === "create" && (
          <Segmented label="Show" value={filter} onChange={setFilter}
            options={[{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }]} />
        )}
        {running > 0 && tab === "create" && <span className="text-[12px] tabular-nums text-ink-tertiary" role="status">{running} running</span>}
        <button type="button" className="ml-auto hidden size-8 items-center justify-center rounded-lg text-ink-tertiary hover:bg-raised hover:text-ink md:flex" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
          <Keyboard size={15} />
        </button>
      </PageHeader>
      {!canEdit && <div className="mb-3"><ReadOnlyEditorNotice canEdit={canEdit} /></div>}
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      {tab === "workflows" ? <StudioWorkflows projectId={projectId} canEdit={canEdit} falReady={falReady} rows={all} /> : (
        <>
          <div className="flex-1 pb-4">
            {!rows ? <Loading label="Loading generations" variant="grid" /> : !shown.length ? (
              <EmptyState icon={<Sparkles size={22} />} title={filter === "all" ? "Nothing generated yet" : "Nothing here yet"}
                body={filter === "all" ? "What you and the project's agents make appears here for the whole team, and in Assets." : undefined} />
            ) : <StudioCanvas rows={shown} all={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy} onAction={act} />}
          </div>
          <div className="sticky bottom-0 z-20 -mx-4 bg-app px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-2 md:-mx-6 md:px-6">
            <div className="mx-auto w-full max-w-3xl">
              <StudioComposer ref={composer} projectId={projectId} canEdit={canEdit} falReady={falReady} rows={all} draft={draft} onDraft={setDraft} />
            </div>
          </div>
        </>
      )}
      {viewed && <StudioViewer row={viewed} rows={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy.has(viewed._id)} onAction={act} onMove={moveViewer} onClose={() => setViewing(null)} />}
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            {SHORTCUTS.map(([keys, label]) => (
              <div key={keys} className="contents">
                <dt><kbd className="rounded-md border border-hairline/60 bg-inset px-1.5 py-0.5 font-mono text-[11.5px] text-ink-secondary">{keys}</kbd></dt>
                <dd className="text-ink-secondary">{label}</dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </section>
  );
}
