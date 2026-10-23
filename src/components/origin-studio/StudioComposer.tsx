import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { AudioLines, Check, ChevronDown, Clapperboard, Image as ImageIcon, KeyRound, LayoutTemplate, Loader2, PencilLine, Plus, Sparkles, TextCursorInput, UserRound, Wand2, WandSparkles, X } from "lucide-react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useStore } from "@/state/store";
import { useBrandKit } from "@/lib/origin-brand";
import { cn } from "@/lib/cn";
import { requestIntegrationFocus } from "../IntegrationKeysSettings";
import { Notice, chipButton, ghostButton, primaryButton, useAction } from "../origin-pages/ui";
import { StudioControls } from "./StudioControls";
import { StudioMediaPicker } from "./StudioMediaPicker";
import { StudioModelPicker } from "./StudioModelPicker";
import { GENERATION_DRAG, KIND_ICON, MediaThumb, Popover, draftForModel, emptyDraft, outputRef, studioPost, type SourceRef, type StudioDraft } from "./studio-ui";
import { studioModel, studioModelsFor, type StudioCharacter, type StudioGeneration, type StudioMediaKind, type StudioMode } from "../../../shared/studio";
import { brandedPrompt, type BrandKit } from "../../../shared/brand-kit";
import { fillBlanks, promptTakesBlanks, setBlank, templateBlanks } from "../../../shared/studio-blanks";
import { presetCard, projectTemplateCard, type StudioTemplate } from "../../../shared/studio-templates";
import { studioPreset, type StudioPreset } from "../../../shared/studio-presets";
import { draftForPreset, draftForTemplate, presetImage, useProjectTemplates } from "./StudioTemplates";

export { draftForModel, emptyDraft } from "./studio-ui";

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

/** A starting file as a square: click to choose, or drop a result from the canvas on it. */
function SourceSlot({ value: source, kind, label, onPick, onClear, onDropRow, disabled }: {
  value?: SourceRef; kind: StudioMediaKind; label: string; onPick(): void; onClear(): void; onDropRow(id: string): void; disabled: boolean;
}) {
  const Icon = KIND_ICON[kind];
  const [over, setOver] = useState(false);
  const accepts = (event: DragEvent) => !disabled && event.dataTransfer.types.includes(GENERATION_DRAG);
  return (
    <div className="flex w-[68px] shrink-0 flex-col items-center gap-1" data-studio-slot={label}
      onDragOver={(event) => { if (accepts(event)) { event.preventDefault(); setOver(true); } }} onDragLeave={() => setOver(false)}
      onDrop={(event) => { setOver(false); if (!accepts(event)) return; event.preventDefault(); onDropRow(event.dataTransfer.getData(GENERATION_DRAG)); }}>
      <div className={cn("group relative size-[68px] overflow-hidden rounded-xl border transition-colors duration-(--motion-fast)",
        source ? "border-hairline/50" : "border-dashed border-hairline", over && "border-accent bg-accent/10")}>
        <button type="button" onClick={onPick} disabled={disabled} aria-label={source ? `${label}: ${source.label}. Change` : `Choose ${label}`} title={source?.label ?? `Choose or drop ${label.toLowerCase()}`}
          className="flex size-full items-center justify-center text-ink-tertiary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60">
          {source ? <MediaThumb kind={kind} url={source.url} className="size-full" /> : <span className="flex flex-col items-center gap-0.5"><Icon size={16} aria-hidden="true" /><Plus size={11} aria-hidden="true" /></span>}
        </button>
        {source && (
          <button type="button" aria-label={`Remove ${label}`} onClick={onClear} disabled={disabled}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity duration-(--motion-fast) group-hover:opacity-100 focus-visible:opacity-100 touch:opacity-100"><X size={11} /></button>
        )}
      </div>
      <span className="w-full truncate text-center text-[11px] text-ink-tertiary">{label}</span>
    </div>
  );
}

/** A template prompt read as a sentence, each `[placeholder]` an inline field. */
function BlankSentence({ prompt, disabled, onChange, onKeyDown }: { prompt: string; disabled: boolean; onChange(prompt: string): void; onKeyDown(event: KeyboardEvent): void }) {
  const blanks = templateBlanks(prompt);
  const parts: Array<string | number> = [];
  let at = 0;
  blanks.forEach((blank, index) => {
    if (blank.start > at) parts.push(prompt.slice(at, blank.start));
    parts.push(index);
    at = blank.end;
  });
  if (at < prompt.length) parts.push(prompt.slice(at));
  return (
    <p className="min-h-[52px] px-1.5 py-1 text-[14.5px] leading-[2.1] text-ink-secondary max-md:text-[16px]" data-studio-blanks>
      {parts.map((part, key) => {
        if (typeof part === "string") return <span key={key} className="whitespace-pre-wrap">{part}</span>;
        const blank = blanks[part]!;
        const width = Math.min(Math.max(blank.value.length, blank.label.length, 6) + 2, 46);
        return (
          <input key={key} data-blank-index={part} value={blank.value} disabled={disabled} aria-label={blank.label || `Blank ${part + 1}`} placeholder={blank.label || "…"}
            onChange={(event) => onChange(setBlank(prompt, part, event.target.value))} onKeyDown={onKeyDown} style={{ width: `${width}ch` }}
            className="mx-0.5 max-w-full rounded-md border-b-2 border-accent/70 bg-accent/10 px-1.5 py-0.5 align-baseline text-[inherit] font-medium leading-normal text-ink outline-none placeholder:font-normal placeholder:text-accent-text/70 focus:bg-accent/20" />
        );
      })}
    </p>
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
  applyPreset(preset: StudioPreset): void;
  applyTemplate(template: StudioTemplate): void;
  generate(): void;
  toggleBrand(): void;
}

type Props = {
  projectId: string; canEdit: boolean; falReady: boolean | null; rows: readonly StudioGeneration[];
  draft: StudioDraft; onDraft(draft: StudioDraft): void; onOpenLibrary(): void; onOpenTemplates(): void;
};

const NEED_LABEL: Record<StudioMediaKind, string> = { image: "Image", video: "Video", audio: "Audio" };

/** The prompt bar: mode, template, starting files, the prompt with its blanks, the model and its settings, then Generate. */
export const StudioComposer = forwardRef<StudioComposerHandle, Props>(function StudioComposer({ projectId, canEdit, falReady, rows, draft, onDraft, onOpenLibrary, onOpenTemplates }, handle) {
  const { dispatch } = useStore();
  const brand = useBrandKit(projectId);
  const library = useCloudQuery<StudioCharacter[]>("studioLibrary:list", { projectId });
  const templates = useProjectTemplates(projectId);
  const [useBrand, setUseBrand] = useState(true);
  const [picking, setPicking] = useState<{ slot: "source" | "reference"; index: number; kind: StudioMediaKind } | null>(null);
  const [models, setModels] = useState(false);
  const [raw, setRaw] = useState(false);
  const focusBlank = useRef(false);
  const action = useAction();
  const enhancing = useAction();
  const prompt = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const model = studioModel(draft.model) ?? studioModelsFor(draft.mode)[0]!;
  const preset = draft.preset ? studioPreset(draft.preset) : undefined;
  const template = draft.template ? templates?.find((entry) => entry._id === draft.template) : undefined;
  const card = preset ? presetCard(preset, presetImage(preset.id)) : template ? projectTemplateCard(template) : null;
  const blanks = promptTakesBlanks(model) ? templateBlanks(draft.prompt) : [];
  const sentence = blanks.length > 0 && !raw;
  const patch = (next: Partial<StudioDraft>) => onDraft({ ...draft, ...next });
  const branded = Boolean(brand) && (draft.mode === "image" || draft.mode === "video") && !model.needs.includes("video");
  const follows = model.kind !== "audio" && model.prompt !== "none" && !model.needs.includes("video");

  useEffect(() => {
    const field = prompt.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
  }, [draft.prompt, raw]);

  useEffect(() => {
    if (!focusBlank.current) return;
    focusBlank.current = false;
    const first = panel.current?.querySelector<HTMLInputElement>('[data-blank-index="0"]');
    if (first) { first.focus(); first.select(); return; }
    const field = prompt.current;
    field?.focus();
    if (draft.mode === "audio") field?.select();
    else field?.setSelectionRange(draft.prompt.length, draft.prompt.length);
  }, [draft.prompt, draft.preset, draft.template, draft.mode]);

  const applyPreset = (next: StudioPreset) => {
    focusBlank.current = true;
    setRaw(false);
    onDraft(draftForPreset(draft, next));
  };
  const applyTemplate = (next: StudioTemplate) => {
    focusBlank.current = true;
    setRaw(false);
    onDraft(draftForTemplate(draft, next));
  };

  const missing = model.needs.findIndex((kind, index) => draft.sources[index]?.kind !== kind);
  const written = promptTakesBlanks(model) ? fillBlanks(draft.prompt) : draft.prompt;
  const ready = canEdit && falReady === true && (model.prompt !== "required" || written.trim()) && missing < 0;

  const generate = () => {
    if (!ready || action.busy) return;
    void action.run(async () => {
      await studioPost("generate", {
        projectId, mode: draft.mode, model: model.id, prompt: written, count: draft.count,
        ...(preset ? { preset: preset.id } : {}), ...(draft.template ? { template: draft.template } : {}), ...(model.angles && draft.angle ? { angle: draft.angle } : {}),
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
    if (!written.trim() || enhancing.busy || !canEdit || !falReady) return;
    void enhancing.run(async () => {
      const { prompt: better } = await studioPost<{ prompt: string }>("enhance", { prompt: written, mode: draft.mode });
      onDraft({ ...draft, prompt: better });
    }, "Could not enhance the prompt");
  };

  useImperativeHandle(handle, () => ({
    focus: () => (panel.current?.querySelector<HTMLInputElement>("[data-blank-index]") ?? prompt.current)?.focus(),
    openModels: () => setModels(true),
    applyPreset,
    applyTemplate,
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
      (event.target as HTMLElement).blur();
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

  const dropRow = (index: number, kind: StudioMediaKind, id: string) => {
    const row = rows.find((candidate) => candidate._id === id);
    const ref = row && outputRef(row);
    if (!ref || ref.kind !== kind) return;
    const sources = [...draft.sources];
    sources[index] = ref;
    patch({ sources });
  };

  const ModelIcon = KIND_ICON[model.kind];
  const latest = rows.find((row) => row.model === model.id && row.status === "done" && row.outputs[0]);

  return (
    <div ref={panel} className="ui-panel flex flex-col gap-2 p-2.5 shadow-[0_18px_50px_-24px_rgb(0_0_0/0.55)]" data-studio-composer>
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
        {card ? (
          <span className={cn(chipButton, "max-w-[240px] gap-2 border-accent/50 pl-1 pr-1 text-ink")} data-studio-preset={card.id} data-studio-template={card.source === "project" ? card.id : undefined}>
            <button type="button" className="flex min-w-0 items-center gap-2" onClick={onOpenTemplates} disabled={!canEdit} title={`${card.description} (T)`}>
              {card.cover ? <MediaThumb kind={card.cover.kind} url={card.cover.url} className="size-6 shrink-0 rounded-full" /> : <LayoutTemplate size={13} className="text-accent-text" />}
              <span className="truncate">{card.name}</span>
            </button>
            <button type="button" aria-label={`Stop using ${card.name}`} onClick={() => onDraft(emptyDraft(draft.mode))} disabled={!canEdit} className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
          </span>
        ) : (
          <button type="button" className={chipButton} disabled={!canEdit} onClick={onOpenTemplates} title="Templates (T)" aria-label="Choose a template" data-studio-presets-button>
            <LayoutTemplate size={13} /><span className="max-sm:hidden">Templates</span>
          </button>
        )}
        {draft.parent && (
          <span className={cn(chipButton, "pr-1 capitalize text-ink")}>
            {draft.parent.action}
            <button type="button" aria-label="Start fresh" onClick={() => onDraft(emptyDraft(draft.mode))} className="flex size-6 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
          </span>
        )}
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
        {follows && library && (library.length > 0 || draft.characterId) && (
          <CharacterChip library={library} value={draft.characterId} disabled={!canEdit} onChange={(characterId) => patch({ characterId })} onManage={onOpenLibrary} />
        )}
        <span className="flex-1" />
        {blanks.length > 0 && (
          <button type="button" className={cn(chipButton, "px-2.5")} onClick={() => setRaw(!raw)} disabled={!canEdit} aria-pressed={raw} title={raw ? "Fill in the blanks" : "Edit the whole prompt"}>
            {raw ? <TextCursorInput size={13} /> : <PencilLine size={13} />}<span className="max-sm:hidden">{raw ? "Fill in" : "Edit text"}</span>
          </button>
        )}
        {branded && brand && <BrandToggle kit={brand} on={useBrand} disabled={!canEdit} onChange={setUseBrand} />}
      </div>
      <div className="flex items-start gap-2">
        {model.needs.length > 0 && (
          <div className="flex shrink-0 gap-1.5 pt-0.5" data-studio-sources>
            {model.needs.map((kind, index) => (
              <SourceSlot key={`${kind}-${index}`} value={draft.sources[index]?.kind === kind ? draft.sources[index] : undefined} kind={kind} disabled={!canEdit}
                label={model.inputLabels?.[index] ?? `${NEED_LABEL[kind]}${model.needs.length > 1 ? ` ${index + 1}` : ""}`}
                onPick={() => setPicking({ slot: "source", index, kind })} onClear={() => patch({ sources: draft.sources.filter((_, other) => other !== index) })}
                onDropRow={(id) => dropRow(index, kind, id)} />
            ))}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {sentence ? <BlankSentence prompt={draft.prompt} disabled={!canEdit} onChange={(next) => patch({ prompt: next })} onKeyDown={onKey} /> : (
            <textarea ref={prompt} value={draft.prompt} onChange={(event) => patch({ prompt: event.target.value })} onKeyDown={onKey} disabled={!canEdit}
              rows={2} maxLength={8_000} aria-label="Prompt" placeholder={model.prompt === "none" ? `${model.label} needs no prompt` : `${PLACEHOLDER[draft.mode]}${model.prompt === "optional" ? " (optional)" : ""}`}
              className="max-h-[220px] min-h-[52px] w-full resize-none bg-transparent px-1.5 py-1 text-[14.5px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary disabled:opacity-60 max-md:text-[16px]" />
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={cn(chipButton, "max-w-[240px] pl-1 text-ink")} disabled={!canEdit} onClick={() => setModels(true)} aria-label={`Model: ${model.label}`} title="Choose a model (M)" data-studio-model>
          {latest?.outputs[0] ? <MediaThumb kind={model.kind} url={latest.outputs[0].url} className="size-6 shrink-0 rounded-full" /> : <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inset"><ModelIcon size={12} /></span>}
          <span className="truncate">{model.label}</span><ChevronDown size={13} className="shrink-0 text-ink-tertiary" />
        </button>
        <StudioControls model={model} draft={draft} disabled={!canEdit} patch={patch} />
        <div className="ml-auto flex items-center gap-1.5">
        {model.prompt !== "none" && (
          <button type="button" className={cn(chipButton, "px-2.5")} disabled={!canEdit || !falReady || !written.trim() || enhancing.busy} onClick={enhance} title="Enhance the prompt (Ctrl+E)" aria-label="Enhance prompt">
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
      {picking && <StudioMediaPicker projectId={projectId} kind={picking.kind} rows={rows} title={picking.slot === "reference" ? "Choose a reference image" : undefined} assetsOnly={picking.slot === "reference"} onPick={pickRef} onClose={() => setPicking(null)} />}
    </div>
  );
});
