import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Megaphone, Sparkles, UserRound, Workflow } from "lucide-react";
import { api, useStore, type Bot } from "@/state/store";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { cn } from "@/lib/cn";
import { CloudGate, EmptyState, Loading, Modal, Notice, PageHeader, ReadOnlyEditorNotice, Segmented, chipButton, pageClass, type OriginPageProps } from "../origin-pages/ui";
import { CampaignDialog, CampaignStrip, isCampaignRun } from "./StudioCampaign";
import { StudioCanvas, type TileAction } from "./StudioCanvas";
import { STUDIO_MODES, StudioComposer, draftForModel, emptyDraft, type StudioComposerHandle } from "./StudioComposer";
import { CharacterEditor, StudioLibrary, type CharacterSeed } from "./StudioLibrary";
import { StudioViewer } from "./StudioViewer";
import { StudioWorkflows } from "./StudioWorkflows";
import { PresetStrip } from "./StudioPresets";
import { consumeStudioFocus, useStudioFocus } from "@/lib/studio-focus";
import { studioPreset } from "../../../shared/studio-presets";
import type { WorkflowDraft } from "./WorkflowEditor";
import { outputRef, studioPost, typing, type StudioDraft } from "./studio-ui";
import { STUDIO_ACTIONS, studioModel, type StudioCharacter, type StudioGeneration, type StudioMediaKind } from "../../../shared/studio";
import type { StudioWorkflowRun } from "../../../shared/studio-workflow";

type Filter = "all" | StudioMediaKind;
type Tab = "create" | "workflows" | "library";

export function StudioPage({ agent, ...props }: OriginPageProps & { agent: Bot }) {
  return <CloudGate {...props} label="Studio">{({ projectId, canEdit, isAdmin }) => <Studio projectId={projectId} canEdit={canEdit} isAdmin={isAdmin} chiefId={agent.id} />}</CloudGate>;
}

/** Whether this app holds a fal key for the project, read again whenever settings close or the window regains focus. */
function useFalReady(projectId: string): boolean | null {
  const { state } = useStore();
  const [ready, setReady] = useState<boolean | null>(null);
  const check = useCallback(() => {
    api<{ fal: boolean }>(`/api/studio/status?projectId=${encodeURIComponent(projectId)}`).then((body) => setReady(body.fal), () => setReady(null));
  }, [projectId]);
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
  ["/", "Write a prompt"], ["Ctrl Enter", "Generate"], ["Ctrl E", "Enhance the prompt"], ["1 – 4", "Image, video, audio, edit"], ["M", "Choose a model"], ["T", "Presets"],
  ["Arrows", "Move between results"], ["Enter", "Open a result"], ["A U R X", "Animate, upscale, remix, extend"], ["P", "Reuse its settings"], ["L", "Save to the library"],
  ["B", "Use in Broadcast"], ["C", "Campaign pack"], ["W", "Workflows"], ["?", "These shortcuts"],
  ["N", "Workflow: add a node"], ["Ctrl Z / Ctrl Shift Z", "Workflow: undo, redo"], ["Ctrl C / V / D", "Workflow: copy, paste, duplicate"],
];

const RECENT_MS = 15 * 60_000;

function draftFrom(row: StudioGeneration): StudioDraft {
  const model = studioModel(row.model);
  const params = row.params ?? {};
  const base = model ? draftForModel(emptyDraft(row.mode), model) : emptyDraft(row.mode);
  return {
    ...base, prompt: row.prompt, ...(row.aspectRatio ? { aspectRatio: row.aspectRatio } : {}), ...(row.duration ? { duration: row.duration } : {}),
    ...(typeof params.resolution === "string" ? { resolution: params.resolution } : {}), ...(typeof params.voice === "string" ? { voice: params.voice } : {}),
    ...(typeof params.motion === "string" ? { motion: params.motion } : {}), ...(typeof params.angle === "string" ? { angle: params.angle } : {}),
    ...(typeof params.preset === "string" && studioPreset(params.preset)?.model === row.model ? { preset: params.preset } : {}), ...(typeof params.negativePrompt === "string" ? { negativePrompt: params.negativePrompt } : {}),
    ...(typeof params.seed === "number" ? { seed: params.seed } : {}), ...(params.sound === false ? { sound: false } : {}),
  };
}

function Studio({ projectId, canEdit, isAdmin, chiefId }: { projectId: string; canEdit: boolean; isAdmin: boolean; chiefId: string }) {
  const rows = useCloudQuery<StudioGeneration[]>("studio:list", { projectId });
  const runs = useCloudQuery<StudioWorkflowRun[]>("studioWorkflows:runs", { projectId });
  const falReady = useFalReady(projectId);
  const [tab, showTab] = useState<Tab>("create");
  const [filter, setFilter] = useState<Filter>("all");
  const [draft, setDraft] = useState<StudioDraft>(() => emptyDraft());
  const [workflow, setWorkflow] = useState<WorkflowDraft | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [campaign, setCampaign] = useState(false);
  const [started, setStarted] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<CharacterSeed | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const composer = useRef<StudioComposerHandle>(null);
  const focus = useStudioFocus(projectId);
  const all = rows ?? [];
  const shown = all.filter((row) => filter === "all" || (row.outputs[0]?.kind ?? row.kind) === filter);
  const running = all.filter((row) => row.status === "queued" || row.status === "running").length;
  const viewed = viewing ? shown.find((row) => row._id === viewing) ?? null : null;
  const pack = useMemo(() => {
    const latest = (runs ?? []).find(isCampaignRun);
    if (!latest || hidden.has(latest._id)) return null;
    return latest._id === started || latest.status === "running" || Date.now() - (latest.finishedAt ?? latest.createdAt) < RECENT_MS ? latest : null;
  }, [runs, hidden, started]);

  const openBroadcast = () => setChiefSectionOf(chiefId, "broadcast");
  /** Leaving Workflows closes the open editor. */
  const setTab = useCallback((next: Tab) => {
    if (next !== "workflows") setWorkflow(null);
    showTab(next);
  }, []);

  useEffect(() => {
    if (!focus) return;
    const preset = focus.presetId ? studioPreset(focus.presetId) : undefined;
    if (preset) { setTab("create"); window.setTimeout(() => composer.current?.applyPreset(preset), 0); }
    if (focus.generationId) { setTab("create"); setViewing(focus.generationId); }
    consumeStudioFocus(focus);
  }, [focus, setTab]);

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

  const saveToLibrary = (row: StudioGeneration) => {
    const ref = outputRef(row);
    if (!ref) return;
    const saved = row.saved.find((entry) => entry.index === 0);
    if (saved) {
      setSaving({ references: [{ ...ref, source: { assetId: saved.assetId } }] });
      return;
    }
    void run(row, async () => {
      const { assetId } = await studioPost<{ assetId: string }>("save-asset", { projectId, generationId: row._id, index: 0 });
      setSaving({ references: [{ ...ref, source: { assetId } }] });
    });
  };

  const act = (row: StudioGeneration, action: TileAction) => {
    const ref = outputRef(row);
    const kind = row.outputs[0]?.kind ?? row.kind;
    const parent = { generationId: row._id, action };
    switch (action) {
      case "open": setViewing(row._id); return;
      case "reuse": prepare({ ...draftFrom(row), characterId: draft.characterId }); return;
      case "library": saveToLibrary(row); return;
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

  const followCharacter = (character: StudioCharacter) => {
    const follows = studioModel(draft.model)?.references || draft.mode === "video";
    const base = follows ? draft : draftForModel(draft, studioModel(emptyDraft(draft.mode === "edit" ? "edit" : "image").model)!);
    prepare({ ...base, characterId: character._id });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (typing(event) || event.metaKey || event.ctrlKey || event.altKey || document.querySelector("[data-centered-dialog]")) return;
      const index = ["1", "2", "3", "4"].indexOf(event.key);
      const key = event.key.toLowerCase();
      if (event.key === "/" && tab === "create") { event.preventDefault(); composer.current?.focus(); }
      else if (event.key === "?") { event.preventDefault(); setHelp(true); }
      else if (key === "w" && !(tab === "workflows" && workflow)) { event.preventDefault(); setTab(tab === "workflows" ? "create" : "workflows"); }
      else if (key === "c" && canEdit && !(tab === "workflows" && workflow)) { event.preventDefault(); setCampaign(true); }
      else if (tab !== "create") return;
      else if (index >= 0 && canEdit) { event.preventDefault(); setDraft((current) => draftForModel(current, studioModel(emptyDraft(STUDIO_MODES[index]!.value).model)!)); }
      else if (key === "t" && canEdit) { event.preventDefault(); composer.current?.openPresets(); }
      else if (key === "m" && canEdit && !(event.target as HTMLElement | null)?.closest?.("[data-studio-tile]")) { event.preventDefault(); composer.current?.openModels(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tab, canEdit, workflow, setTab]);

  const moveViewer = (step: -1 | 1) => {
    const done = shown.filter((row) => row.status === "done");
    const at = done.findIndex((row) => row._id === viewing);
    const next = done[(at + step + done.length) % done.length];
    if (next) setViewing(next._id);
  };

  const openRun = (target: StudioWorkflowRun) => {
    setWorkflow({ ...(target.workflowId ? { workflowId: target.workflowId } : {}), name: target.name, graph: target.graph, runId: target._id });
    showTab("workflows");
  };

  return (
    <section className={cn(pageClass, "pb-0")} aria-label="Studio">
      <PageHeader title="Studio" count={tab === "create" ? rows?.length : undefined}>
        <Segmented label="Studio view" value={tab} onChange={setTab}
          options={[
            { value: "create", label: <><Sparkles size={13} />Studio</>, title: "Studio" },
            { value: "workflows", label: <><Workflow size={13} />Workflows</>, title: "Workflows (W)" },
          ]} />
        {tab === "create" && (
          <Segmented label="Show" value={filter} onChange={setFilter}
            options={[{ value: "all", label: "All" }, { value: "image", label: "Images" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }]} />
        )}
        {running > 0 && tab === "create" && <span className="text-[12px] tabular-nums text-ink-tertiary" role="status">{running} running</span>}
        {canEdit && (
          <button type="button" className={cn(chipButton, "text-ink")} onClick={() => setCampaign(true)} title="One brief, a whole campaign (C)">
            <Megaphone size={13} className="text-accent-text" />Campaign pack
          </button>
        )}
        <button type="button" aria-pressed={tab === "library"} className={cn(chipButton, tab === "library" && "border-accent/50 text-ink")} onClick={() => setTab(tab === "library" ? "create" : "library")} aria-label="Library" title="Characters, products and styles">
          <UserRound size={13} /><span className="max-sm:hidden">Library</span>
        </button>
        <button type="button" className="hidden size-8 items-center justify-center rounded-lg text-ink-tertiary hover:bg-raised hover:text-ink md:flex" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts (?)" title="Keyboard shortcuts (?)">
          <Keyboard size={15} />
        </button>
      </PageHeader>
      {!canEdit && <div className="mb-3"><ReadOnlyEditorNotice canEdit={canEdit} /></div>}
      {error && <div className="mb-3"><Notice tone="danger">{error}</Notice></div>}
      {tab === "workflows" && (
        <StudioWorkflows projectId={projectId} canEdit={canEdit} falReady={falReady} rows={all} draft={workflow} onDraft={setWorkflow} onOpenBroadcast={openBroadcast} />
      )}
      {tab === "library" && <StudioLibrary projectId={projectId} canEdit={canEdit} rows={all} onUse={followCharacter} />}
      {tab === "create" && (
        <>
          <div className="flex-1 pb-4">
            {pack && (
              <CampaignStrip run={pack} onOpenRun={() => openRun(pack)} onOpenBroadcast={openBroadcast} onDismiss={() => setHidden((current) => new Set(current).add(pack._id))}
                onStop={() => void studioPost("workflow/cancel", { projectId, runId: pack._id }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))} />
            )}
            {!rows ? <Loading label="Loading generations" variant="grid" /> : !shown.length ? (<>
              {filter === "all" && canEdit && <PresetStrip onPick={(preset) => composer.current?.applyPreset(preset)} onMore={() => composer.current?.openPresets()} />}
              <EmptyState icon={<Sparkles size={22} />} title={filter === "all" ? "Nothing generated yet" : "Nothing here yet"}
                body={filter === "all" ? "What you and the project's agents make appears here for the whole team, and in Assets." : undefined} />
            </>) : <StudioCanvas rows={shown} all={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy} onAction={act} />}
          </div>
          <div className="sticky bottom-0 z-20 -mx-4 bg-gradient-to-t from-app from-70% to-transparent px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-4 md:-mx-6 md:px-6">
            <div className="mx-auto w-full max-w-3xl">
              <StudioComposer ref={composer} projectId={projectId} canEdit={canEdit} falReady={falReady} rows={all} draft={draft} onDraft={setDraft} onOpenLibrary={() => setTab("library")} />
            </div>
          </div>
        </>
      )}
      {viewed && <StudioViewer row={viewed} rows={all} canEdit={canEdit} isAdmin={isAdmin} busy={busy.has(viewed._id)} onAction={act} onMove={moveViewer} onClose={() => setViewing(null)} />}
      {campaign && <CampaignDialog projectId={projectId} falReady={falReady} onStarted={(runId) => { setStarted(runId); setTab("create"); }} onClose={() => setCampaign(false)} />}
      {saving && <CharacterEditor projectId={projectId} rows={all} seed={saving} onClose={() => setSaving(null)} />}
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
