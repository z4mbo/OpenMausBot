import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Check, ChevronDown, Clapperboard, Image as ImageIcon, KeyRound, LayoutGrid, Loader2, Plus, Sparkles, UserRound, Wand2, WandSparkles, X } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useStore } from "@/state/store";
import { useBrandKit } from "@/lib/origin-brand";
import { cn } from "@/lib/cn";
import { requestIntegrationFocus } from "../IntegrationKeysSettings";
import { Notice, chipButton, ghostButton, primaryButton, useAction } from "../origin-pages/ui";
import { StudioControls } from "./StudioControls";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { StudioModelPicker } from "./StudioModelPicker";
import { KIND_ICON, MediaThumb, Popover, studioPost, type SourceRef, type StudioDraft } from "./studio-ui";
import { studioModel, studioModelsFor, type StudioCharacter, type StudioGeneration, type StudioMediaKind, type StudioMode, type StudioModel } from "../../../shared/studio";
import { brandedPrompt, type BrandKit } from "../../../shared/brand-kit";
import { presetBlank, presetPromptText, studioPreset, type StudioPreset } from "../../../shared/studio-presets";
import { StudioPresetGallery, draftForPreset, presetImage } from "./StudioPresets";

export const STUDIO_MODES: readonly { value: StudioMode; label: string; icon: typeof ImageIcon }[] = [
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "video", label: "Video", icon: Clapperboard },
  { value: "audio", label: "Audio", icon: AudioLines },
  { value: "edit", label: "Edit", icon: Wand2 },
];

const PLACEHOLDER: Record<StudioMode, string> = {
  image: "Describe the image",
  video: "Describe the shot and how it moves",
  audio: "Words to speak, or the music or sound you want",
  edit: "How to change it",
};

export function emptyDraft(mode: StudioMode = "image"): StudioDraft {
  return { mode, model: studioModelsFor(mode)[0]!.id, prompt: "", sources: [], references: [], count: 1 };
}

/** The draft after switching to a model: sources it cannot take are dropped, settings it lacks are cleared. */
export function draftForModel(draft: StudioDraft, model: StudioModel): StudioDraft {
  return {
    ...draft, mode: model.mode, model: model.id, preset: draft.preset && studioPreset(draft.preset)?.model === model.id ? draft.preset : undefined,
    sources: model.needs.map((kind, index) => draft.sources[index]?.kind === kind ? draft.sources[index]! : null).filter((ref): ref is SourceRef => ref !== null),
    references: draft.references.slice(0, model.references ?? 0), count: Math.min(draft.count, model.maxCount),
  };
}

export function openFalSettings(dispatch: ReturnType<typeof useStore>["dispatch"]) {
  requestIntegrationFocus("fal");
  dispatch({ type: "toggleAppSettings", open: true, section: "integrations" });
}

function BrandToggle({ kit, on, disabled, onChange }: { kit: BrandKit; on: boolean; disabled: boolean; onChange(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} title={`Prompts start with: ${brandedPrompt(kit, "").trim()} (B)`}
      className={cn(chipButton, on ? "border-accent/50 text-ink" : "text-ink-tertiary")}>
      <span className={cn("flex transition-opacity duration-(--motion-fast)", !on && "opacity-40")} aria-hidden="true">
        <span className="size-3 rounded-full ring-2 ring-panel" style={{ background: kit.colors.primary }} />
        <span className="-ml-1 size-3 rounded-full ring-2 ring-panel" style={{ background: kit.colors.secondary }} />
      </span>
      Use brand
    </button>
  );
}

function SourceChip({ value: source, kind, label, onPick, onClear, disabled }: { value?: SourceRef; kind: StudioMediaKind; label: string; onPick(): void; onClear(): void; disabled: boolean }) {
  const Icon = KIND_ICON[kind];
  if (!source) {
    return <button type="button" className={cn(chipButton, "border-dashed")} onClick={onPick} disabled={disabled}><Icon size={13} />{label}</button>;
  }
  return (
    <span className={cn(chipButton, "gap-2 pl-1 pr-1")}>
      <button type="button" className="flex min-w-0 items-center gap-2" onClick={onPick} disabled={disabled} title={`Change: ${source.label}`}>
        <MediaThumb kind={kind} url={source.url} className="size-6 shrink-0 rounded-full" />
        <span className="truncate">{source.label}</span>
      </button>
      <button type="button" aria-label={`Remove ${source.label}`} onClick={onClear} disabled={disabled} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
    </span>
  );
}

/** The library entry the next generation follows: its references and description join the prompt. */
function CharacterChip({ library, value, disabled, onChange, onManage }: {
  library: readonly StudioCharacter[]; value?: string; disabled: boolean; onChange(id: string | undefined): void; onManage(): void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const chosen = library.find((entry) => entry._id === value);
  return (
    <div className="relative">
      {chosen ? (
        <span className={cn(chipButton, "gap-2 border-accent/50 pl-1 pr-1 text-ink")}>
          <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(!open)} disabled={disabled} aria-label={`Following ${chosen.name}`} aria-expanded={open}>
            <MediaThumb kind="image" url={chosen.references[0]?.url ?? undefined} className="size-6 shrink-0 rounded-full" />
            <span className="truncate">{chosen.name}</span>
          </button>
          <button type="button" aria-label={`Stop following ${chosen.name}`} onClick={() => onChange(undefined)} disabled={disabled} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
        </span>
      ) : (
        <button type="button" className={cn(chipButton, "border-dashed")} onClick={() => setOpen(!open)} disabled={disabled} aria-expanded={open} title="Keep a character, product or style consistent">
          <UserRound size={13} />Character
        </button>
      )}
      <Popover open={open} onClose={close} label="Library">
        {library.map((entry) => (
          <button key={entry._id} type="button" aria-pressed={entry._id === value} onClick={() => { onChange(entry._id); close(); }}
            className={cn("flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-raised focus-visible:bg-raised", entry._id === value && "bg-raised")}>
            <MediaThumb kind="image" url={entry.references[0]?.url ?? undefined} className="size-8 shrink-0 rounded-md" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] text-ink">{entry.name}</span>
              <span className="truncate text-[11.5px] capitalize text-ink-tertiary">{entry.kind}</span>
            </span>
            {entry._id === value && <Check size={13} className="text-accent-text" aria-hidden="true" />}
          </button>
        ))}
        {!library.length && <p className="px-2 py-2 text-[12.5px] text-ink-tertiary">Nothing saved yet</p>}
        <button type="button" onClick={() => { close(); onManage(); }} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-hairline/30 px-2 py-2 text-left text-[12.5px] text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:bg-raised">
          <Plus size={13} />{library.length ? "Manage library" : "Add to the library"}
        </button>
      </Popover>
    </div>
  );
}

export interface StudioComposerHandle {
  focus(): void;
  openModels(): void;
  openPresets(): void;
  applyPreset(preset: StudioPreset): void;
  generate(): void;
  toggleBrand(): void;
}

type Props = {
  projectId: string; canEdit: boolean; falReady: boolean | null; rows: readonly StudioGeneration[];
  draft: StudioDraft; onDraft(draft: StudioDraft): void; onOpenLibrary(): void;
};

/** The prompt bar: mode chips, starting files, the prompt, the model and its settings, then Generate. */
export const StudioComposer = forwardRef<StudioComposerHandle, Props>(function StudioComposer({ projectId, canEdit, falReady, rows, draft, onDraft, onOpenLibrary }, handle) {
  const { dispatch } = useStore();
  const brand = useBrandKit(projectId);
  const library = useCloudQuery<StudioCharacter[]>("studioLibrary:list", { projectId });
  const [useBrand, setUseBrand] = useState(true);
  const [picking, setPicking] = useState<{ slot: "source" | "reference"; index: number; kind: StudioMediaKind } | null>(null);
  const [models, setModels] = useState(false);
  const [presets, setPresets] = useState(false);
  const selectBlank = useRef(false);
  const action = useAction();
  const enhancing = useAction();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const model = studioModel(draft.model) ?? studioModelsFor(draft.mode)[0]!;
  const preset = draft.preset ? studioPreset(draft.preset) : undefined;
  const patch = (next: Partial<StudioDraft>) => onDraft({ ...draft, ...next });
  const branded = Boolean(brand) && (draft.mode === "image" || draft.mode === "video") && !model.needs.includes("video");
  const follows = model.kind !== "audio" && model.prompt !== "none" && !model.needs.includes("video");

  useEffect(() => {
    const field = prompt.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
    if (!selectBlank.current) return;
    selectBlank.current = false;
    const blank = presetBlank(draft.prompt);
    field.focus();
    if (blank) field.setSelectionRange(blank.start, blank.end);
    else if (draft.mode === "audio") field.select();
    else field.setSelectionRange(draft.prompt.length, draft.prompt.length);
  }, [draft.prompt, draft.preset, draft.mode]);

  const applyPreset = (next: StudioPreset) => {
    selectBlank.current = true;
    onDraft(draftForPreset(draft, next));
  };

  const missing = model.needs.findIndex((kind, index) => draft.sources[index]?.kind !== kind);
  const ready = canEdit && falReady === true && (model.prompt !== "required" || draft.prompt.trim()) && missing < 0;

  const generate = () => {
    if (!ready || action.busy) return;
    void action.run(async () => {
      await studioPost("generate", {
        projectId, mode: draft.mode, model: model.id, prompt: preset && model.family !== "tts" ? presetPromptText(draft.prompt) : draft.prompt, count: draft.count,
        ...(preset ? { preset: preset.id } : {}), ...(model.angles && draft.angle ? { angle: draft.angle } : {}),
        ...(draft.aspectRatio ? { aspectRatio: draft.aspectRatio } : {}), ...(draft.duration ? { duration: draft.duration } : {}),
        ...(draft.resolution ? { resolution: draft.resolution } : {}), ...(draft.voice ? { voice: draft.voice } : {}),
        ...(draft.seed !== undefined ? { seed: draft.seed } : {}), ...(draft.negativePrompt?.trim() ? { negativePrompt: draft.negativePrompt } : {}),
        ...(draft.motion ? { motion: draft.motion } : {}), ...(draft.sound === false ? { sound: false } : {}),
        sources: draft.sources.map((ref) => ref.source), referenceAssetIds: draft.references.flatMap((ref) => ("assetId" in ref.source ? [ref.source.assetId] : [])),
        ...(draft.parent ? { parent: draft.parent } : {}), ...(branded ? { brand: useBrand } : {}),
        ...(follows && draft.characterId ? { characterId: draft.characterId } : {}),
      });
      onDraft({ ...draft, parent: undefined, seed: draft.seed });
    }, "Could not start the generation");
  };

  const enhance = () => {
    if (!draft.prompt.trim() || enhancing.busy || !canEdit || !falReady) return;
    void enhancing.run(async () => {
      const { prompt: better } = await studioPost<{ prompt: string }>("enhance", { prompt: draft.prompt, mode: draft.mode });
      onDraft({ ...draft, prompt: better });
    }, "Could not enhance the prompt");
  };

  useImperativeHandle(handle, () => ({
    focus: () => prompt.current?.focus(),
    openModels: () => setModels(true),
    openPresets: () => setPresets(true),
    applyPreset,
    generate,
    toggleBrand: () => setUseBrand((on) => !on),
  }));

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      generate();
    } else if (event.key.toLowerCase() === "e" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      enhance();
    } else if (event.key === "Escape") {
      prompt.current?.blur();
    }
  };

  const pickRef = (ref: SourceRef) => {
    if (!picking) return;
    if (picking.slot === "source") {
      const sources = [...draft.sources];
      sources[picking.index] = ref;
      patch({ sources });
    } else {
      patch({ references: [...draft.references.slice(0, picking.index), ref, ...draft.references.slice(picking.index + 1)] });
    }
  };

  const ModelIcon = KIND_ICON[model.kind];
  const latest = rows.find((row) => row.model === model.id && row.status === "done" && row.outputs[0]);
  const hasMedia = model.needs.length > 0 || Boolean(model.references);

  return (
    <div className="ui-panel flex flex-col gap-2 p-2.5" data-studio-composer>
      <div className="flex flex-wrap items-center gap-1.5">
        <div role="group" aria-label="What to make" className="flex rounded-lg bg-inset p-0.5">
          {STUDIO_MODES.map(({ value, label, icon: Icon }, index) => (
            <button key={value} type="button" aria-pressed={draft.mode === value} aria-label={label} title={`${label} (${index + 1})`}
              onClick={() => onDraft(draftForModel(draft.mode === value ? draft : { ...draft, aspectRatio: undefined, duration: undefined, resolution: undefined }, draft.mode === value ? model : studioModelsFor(value)[0]!))}
              className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] text-ink-secondary outline-none transition-colors duration-(--motion-fast) hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60", draft.mode === value && "bg-raised text-ink")}>
              <Icon size={13} /><span className="max-sm:hidden">{label}</span>
            </button>
          ))}
        </div>
        {preset ? (
          <span className={cn(chipButton, "gap-2 border-accent/50 pl-1 pr-1 text-ink")} data-studio-preset={preset.id}>
            <button type="button" className="flex min-w-0 items-center gap-2" onClick={() => setPresets(true)} disabled={!canEdit} title={`${preset.description} (T)`}>
              <img src={presetImage(preset.id)} alt="" className="size-6 shrink-0 rounded-full object-cover" />
              <span className="truncate">{preset.label}</span>
            </button>
            <button type="button" aria-label={`Stop using ${preset.label}`} onClick={() => onDraft(emptyDraft(draft.mode))} disabled={!canEdit} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
          </span>
        ) : (
          <button type="button" className={chipButton} disabled={!canEdit} onClick={() => setPresets(true)} title="Presets (T)" data-studio-presets-button>
            <LayoutGrid size={13} /><span className="max-sm:hidden">Presets</span>
          </button>
        )}
        {draft.parent && (
          <span className={cn(chipButton, "pr-1 capitalize text-ink")}>
            {draft.parent.action}
            <button type="button" aria-label="Start fresh" onClick={() => onDraft(emptyDraft(draft.mode))} className="flex size-6 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
          </span>
        )}
        {hasMedia && (
          <div className="contents" data-studio-sources>
            {model.needs.map((kind, index) => (
              <SourceChip key={`${kind}-${index}`} value={draft.sources[index]?.kind === kind ? draft.sources[index] : undefined} kind={kind} disabled={!canEdit}
                label={model.inputLabels?.[index] ?? `${kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio"}${model.needs.length > 1 ? ` ${index + 1}` : ""}`}
                onPick={() => setPicking({ slot: "source", index, kind })} onClear={() => patch({ sources: draft.sources.filter((_, other) => other !== index) })} />
            ))}
            {draft.references.map((ref, index) => (
              <SourceChip key={`ref-${index}`} value={ref} kind="image" label="Reference" disabled={!canEdit}
                onPick={() => setPicking({ slot: "reference", index, kind: "image" })} onClear={() => patch({ references: draft.references.filter((_, other) => other !== index) })} />
            ))}
            {(model.references ?? 0) > draft.references.length && (
              <button type="button" className={cn(chipButton, "border-dashed")} disabled={!canEdit} onClick={() => setPicking({ slot: "reference", index: draft.references.length, kind: "image" })}
                title="Reference images keep a character, product or style consistent">
                <Plus size={13} />Reference
              </button>
            )}
          </div>
        )}
        {follows && library && (library.length > 0 || draft.characterId) && (
          <CharacterChip library={library} value={draft.characterId} disabled={!canEdit} onChange={(characterId) => patch({ characterId })} onManage={onOpenLibrary} />
        )}
        <span className="flex-1" />
        {branded && brand && <BrandToggle kit={brand} on={useBrand} disabled={!canEdit} onChange={setUseBrand} />}
      </div>
      <textarea ref={prompt} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} onKeyDown={onKey} disabled={!canEdit}
        rows={2} maxLength={8_000} aria-label="Prompt" placeholder={model.prompt === "none" ? `${model.label} needs no prompt` : `${PLACEHOLDER[draft.mode]}${model.prompt === "optional" ? " (optional)" : ""}`}
        className="max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-1.5 py-1 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary disabled:opacity-60 max-md:text-[16px]" />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={cn(chipButton, "max-w-[240px] pl-1 text-ink")} disabled={!canEdit} onClick={() => setModels(true)} aria-label={`Model: ${model.label}`} title="Choose a model (M)" data-studio-model>
          {latest?.outputs[0] ? <MediaThumb kind={model.kind} url={latest.outputs[0].url} className="size-6 shrink-0 rounded-full" /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset"><ModelIcon size={12} /></span>}
          <span className="truncate">{model.label}</span><ChevronDown size={13} className="shrink-0 text-ink-tertiary" />
        </button>
        <StudioControls model={model} draft={draft} disabled={!canEdit} patch={patch} />
        <div className="ml-auto flex items-center gap-1.5">
        {model.prompt !== "none" && (
          <button type="button" className={cn(chipButton, "px-2.5")} disabled={!canEdit || !falReady || !draft.prompt.trim() || enhancing.busy} onClick={enhance} title="Enhance the prompt (Ctrl+E)" aria-label="Enhance prompt">
            {enhancing.busy ? <Loader2 size={13} className="animate-spin" /> : <WandSparkles size={13} />}<span className="max-sm:hidden">Enhance</span>
          </button>
        )}
        {falReady === false ? (
          <span className="flex items-center gap-2 text-[12.5px] text-ink-secondary" data-studio-missing-key>
            <KeyRound size={14} aria-hidden="true" />Add your fal.ai key to generate.
            <button type="button" className={ghostButton} onClick={() => openFalSettings(dispatch)}>Add key</button>
          </span>
        ) : (
          <button type="button" className={primaryButton} disabled={!ready || action.busy} onClick={generate} title="Generate (Ctrl+Enter)">
            {action.busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}Generate
          </button>
        )}
        </div>
      </div>
      {(action.error || enhancing.error) && <Notice tone="danger">{action.error || enhancing.error}</Notice>}
      {models && <StudioModelPicker mode={draft.mode} current={model.id} rows={rows} onClose={() => setModels(false)} onPick={(next) => { onDraft(draftForModel(draft, next)); setModels(false); prompt.current?.focus(); }} />}
      {presets && <StudioPresetGallery current={draft.preset} onClose={() => setPresets(false)} onPick={(next) => { setPresets(false); applyPreset(next); }} />}
      {picking && <StudioMediaPicker projectId={projectId} kind={picking.kind} rows={rows} title={picking.slot === "reference" ? "Choose a reference image" : undefined} assetsOnly={picking.slot === "reference"} onPick={pickRef} onClose={() => setPicking(null)} />}
    </div>
  );
});
