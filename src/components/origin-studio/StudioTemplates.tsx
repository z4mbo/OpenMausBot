import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowRight, LayoutTemplate, Loader2, Search, TextCursorInput, Trash2 } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { useVideoPoster } from "@/lib/video-poster";
import { cn } from "@/lib/cn";
import { Field, Modal, Notice, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { KIND_ICON, MediaThumb, draftForModel, emptyDraft, type SourceRef, type StudioDraft } from "./studio-ui";
import { studioModel, type StudioGeneration, type StudioModel, type StudioParams } from "../../../shared/studio";
import { STUDIO_PRESET_GROUPS, STUDIO_PRESETS, studioPresetModel, type StudioPreset } from "../../../shared/studio-presets";
import { markBlank, promptTakesBlanks, templateBlanks } from "../../../shared/studio-blanks";
import {
  STUDIO_TEMPLATE_DESCRIPTION_MAX, STUDIO_TEMPLATE_NAME_MAX, presetCard, projectTemplateCard, settingsLine, templateFromGeneration, templateName,
  type StudioTemplate, type TemplateCard,
} from "../../../shared/studio-templates";

const IMAGES = import.meta.glob<string>("../../assets/studio-presets/*.webp", { eager: true, query: "?url", import: "default" });

export function presetImage(id: string): string | undefined {
  return IMAGES[`../../assets/studio-presets/${id}.webp`];
}

export function useProjectTemplates(projectId: string): StudioTemplate[] | undefined {
  return useCloudQuery<StudioTemplate[]>("studioTemplates:list", { projectId });
}

const text = (value: StudioParams[string] | undefined) => (typeof value === "string" && value ? value : undefined);

/** The prompt bar set up for a preset: its model, settings and starting prompt, keeping files that still fit. */
export function draftForPreset(draft: StudioDraft, preset: StudioPreset): StudioDraft {
  const model = studioPresetModel(preset);
  const base = draftForModel(draft.mode === model.mode ? draft : emptyDraft(model.mode), model);
  return {
    ...base, preset: preset.id, template: undefined, prompt: preset.prompt ?? "", parent: undefined,
    aspectRatio: preset.aspectRatio, duration: preset.duration, resolution: preset.resolution, motion: preset.motion, angle: preset.angle,
    ...(preset.sound === false ? { sound: false } : { sound: undefined }),
  };
}

/** The prompt bar set up for a project template: its model, settings, prompt and example inputs. */
export function draftForTemplate(draft: StudioDraft, template: StudioTemplate): StudioDraft {
  const model = studioModel(template.model);
  if (!model) return draft;
  const base = draftForModel(draft.mode === model.mode ? draft : emptyDraft(model.mode), model);
  const sources: SourceRef[] = [];
  for (const [index, source] of template.sources.entries()) {
    if (!source.url || model.needs[index] !== source.kind) break;
    sources.push({ kind: source.kind, label: source.name, url: source.url, source: { assetId: source.assetId } });
  }
  const params = template.params;
  return {
    ...base, template: template._id, preset: undefined, prompt: template.prompt, parent: undefined, sources,
    aspectRatio: text(params.aspectRatio), duration: text(params.duration), resolution: text(params.resolution), voice: text(params.voice),
    motion: text(params.motion), angle: text(params.angle), negativePrompt: text(params.negativePrompt), sound: params.sound === false ? false : undefined,
  };
}

function Cover({ card, compact }: { card: TemplateCard; compact?: boolean }) {
  const poster = useVideoPoster(card.cover?.kind === "video" ? card.cover.url : undefined);
  const Icon = KIND_ICON[card.model.kind];
  const media = "size-full object-cover transition-transform duration-(--motion-slow) group-hover:scale-[1.04] motion-reduce:transition-none";
  if (card.cover?.kind === "video") {
    return <video src={card.cover.url} poster={poster} muted loop playsInline preload={poster ? "none" : "metadata"} className={media}
      onMouseEnter={(event) => void event.currentTarget.play().catch(() => undefined)} onMouseLeave={(event) => event.currentTarget.pause()} />;
  }
  if (card.cover?.kind === "image") return <img src={card.cover.url} alt="" loading="lazy" draggable={false} className={media} />;
  return <span className="flex size-full items-center justify-center bg-gradient-to-br from-accent/20 via-inset to-inset text-ink-tertiary"><Icon size={compact ? 20 : 28} aria-hidden="true" /></span>;
}

/** One template as a poster: its cover, name and what a person brings to it. */
export function TemplateTile({ card, current, compact, onPick, onRemove }: { card: TemplateCard; current?: boolean; compact?: boolean; onPick(): void; onRemove?(): void }) {
  const Icon = KIND_ICON[card.model.kind];
  return (
    <article className={cn("group relative min-w-0", compact && "w-36 shrink-0 sm:w-40")} data-template-card={card.id} data-template-source={card.source}>
      <button type="button" onClick={onPick} aria-pressed={current} title={card.description}
        className={cn("relative flex w-full flex-col overflow-hidden rounded-xl border bg-inset text-left outline-none transition-[border-color,box-shadow] duration-(--motion-fast) focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40",
          current ? "border-accent/80" : "border-hairline/40 hover:border-hairline", compact ? "aspect-[4/5]" : "aspect-[4/5] sm:aspect-[3/4]")}>
        <span className="absolute inset-0"><Cover card={card} compact={compact} /></span>
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-transparent" aria-hidden="true" />
        <span className="absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] font-medium text-white/90 backdrop-blur-sm">
            <Icon size={10} aria-hidden="true" />{card.source === "project" ? "Yours" : STUDIO_PRESET_GROUPS.find((group) => group.value === card.group)?.label ?? "Preset"}
          </span>
          {card.blanks > 0 && !compact && (
            <span className="flex items-center gap-1 rounded-full bg-black/55 px-1.5 py-0.5 text-[10.5px] text-white/80 backdrop-blur-sm" title="Words you fill in">
              <TextCursorInput size={10} aria-hidden="true" />{card.blanks}
            </span>
          )}
        </span>
        <span className={cn("relative mt-auto flex min-w-0 flex-col gap-0.5 text-white", compact ? "p-2" : "p-3")}>
          <span className={cn("truncate font-semibold tracking-[-0.01em]", compact ? "text-[12.5px]" : "text-[14px]")}>{card.name}</span>
          {!compact && <span className="line-clamp-2 text-[11.5px] leading-snug text-white/75">{card.description}</span>}
          <span className="truncate text-[10.5px] text-white/60">{card.inputs.length ? card.inputs.join(" + ") : "Prompt"}{card.by ? ` · ${card.by}` : ""}</span>
        </span>
        {!compact && (
          <span className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-full bg-white text-black opacity-0 shadow transition-opacity duration-(--motion-fast) group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100" aria-hidden="true">
            <ArrowRight size={14} />
          </span>
        )}
      </button>
      {onRemove && (
        <button type="button" className={cn(iconButton, "absolute bottom-2 right-2 size-7 bg-black/55 text-white/80 opacity-0 hover:text-white group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100")}
          onClick={onRemove} aria-label={`Delete ${card.name}`} title="Delete template"><Trash2 size={13} /></button>
      )}
    </article>
  );
}

export function PresetTile({ preset, current, onPick, compact }: { preset: StudioPreset; current?: boolean; onPick(): void; compact?: boolean }) {
  return <TemplateTile card={presetCard(preset, presetImage(preset.id))} current={current} onPick={onPick} compact={compact} />;
}

type Group = "all" | "project" | StudioPreset["group"];

/** Every template a project can start from: its own first, then Studio's presets, searchable and grouped. */
export function useTemplateCards(projectId: string): { cards: TemplateCard[]; templates: StudioTemplate[] } {
  const templates = useProjectTemplates(projectId);
  return useMemo(() => {
    const own = (templates ?? []).flatMap((template) => { const card = projectTemplateCard(template); return card ? [card] : []; });
    return { templates: templates ?? [], cards: [...own, ...STUDIO_PRESETS.map((preset) => presetCard(preset, presetImage(preset.id)))] };
  }, [templates]);
}

export type TemplatePick = { preset: StudioPreset } | { template: StudioTemplate };

/** The template gallery: search, a row of groups and the posters; Enter in the search picks the first match. */
export function TemplateGallery({ projectId, canEdit, current, onPick, autoFocus }: {
  projectId: string; canEdit: boolean; current?: string; onPick(pick: TemplatePick): void; autoFocus?: boolean;
}) {
  const { cards, templates } = useTemplateCards(projectId);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState<Group>("all");
  const [error, setError] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const shown = cards.filter((card) => (group === "all" || card.group === group)
    && (!needle || `${card.name} ${card.description} ${card.model.label} ${card.inputs.join(" ")}`.toLowerCase().includes(needle)));
  const groups: { value: Group; label: string; count: number }[] = [
    { value: "all" as const, label: "All", count: cards.length },
    { value: "project" as const, label: "Yours", count: cards.filter((card) => card.source === "project").length },
    ...STUDIO_PRESET_GROUPS.map((entry) => ({ value: entry.value, label: entry.label, count: cards.filter((card) => card.group === entry.value).length })),
  ].filter((entry) => entry.count > 0 || entry.value === "project");

  const pick = (card: TemplateCard) => {
    if (card.source === "preset") { const preset = STUDIO_PRESETS.find((entry) => entry.id === card.id); if (preset) onPick({ preset }); return; }
    const template = templates.find((entry) => entry._id === card.id);
    if (template) onPick({ template });
  };
  const remove = (card: TemplateCard) => {
    if (!window.confirm(`Delete the template ${card.name}? What it made stays in Studio and Assets.`)) return;
    void cloudMutation("studioTemplates:remove", { projectId, templateId: card.id }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const tiles = [...(grid.current?.querySelectorAll<HTMLButtonElement>("[data-template-card] > button:first-child") ?? [])];
    const at = tiles.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const columns = Math.max(1, Math.round((grid.current?.clientWidth ?? 600) / (tiles[0]?.offsetWidth ?? 200)));
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : -columns;
    tiles[Math.min(Math.max(at + step, 0), tiles.length - 1)]?.focus();
  };

  return (
    <div className="flex flex-col gap-3" data-template-gallery>
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative flex w-full items-center sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
          <input autoFocus={autoFocus && !matchMedia("(pointer: coarse)").matches} className={cn(inputClass, "pl-8")} placeholder="Search templates" aria-label="Search templates" value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") { event.preventDefault(); grid.current?.querySelector<HTMLButtonElement>("[data-template-card] > button")?.focus(); }
              if (event.key === "Enter" && shown[0]) { event.preventDefault(); pick(shown[0]); }
            }} />
        </label>
        <div role="group" aria-label="Template groups" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1">
          {groups.map((entry) => (
            <button key={entry.value} type="button" aria-pressed={group === entry.value} onClick={() => setGroup(entry.value)}
              className={cn("flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[12.5px] outline-none transition-colors duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-accent/60",
                group === entry.value ? "border-ink/80 bg-ink text-app" : "border-hairline/50 text-ink-secondary hover:border-hairline hover:text-ink")}>
              {entry.label}<span className={cn("tabular-nums", group === entry.value ? "text-app/70" : "text-ink-tertiary")}>{entry.count}</span>
            </button>
          ))}
        </div>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {group === "project" && !shown.length && (
        <p className="rounded-xl border border-dashed border-hairline/60 px-4 py-6 text-center text-[13px] text-ink-tertiary">
          Open any result and choose <span className="text-ink-secondary">Save as template</span>; its prompt's [bracketed words] become the blanks people fill in.
        </p>
      )}
      <div ref={grid} onKeyDown={move} className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
        {shown.map((card) => <TemplateTile key={`${card.source}:${card.id}`} card={card} current={card.id === current} onPick={() => pick(card)} onRemove={card.source === "project" && canEdit ? () => remove(card) : undefined} />)}
      </div>
      {needle && !shown.length && <p className="py-8 text-center text-[13px] text-ink-tertiary">No template matches “{query}”.</p>}
      <p className="text-[11px] text-ink-tertiary">Preset preview images from ComfyUI's workflow templates, © Comfy Org, MIT License.</p>
    </div>
  );
}

/** A scrolling row of templates over the results: the project's own first. */
export function TemplateStrip({ projectId, onPick, onBrowse }: { projectId: string; onPick(pick: TemplatePick): void; onBrowse(): void }) {
  const { cards, templates } = useTemplateCards(projectId);
  const featured = ["motion-transfer", "character-swap", "virtual-try-on", "camera-angle", "relight", "start-end-frame", "restyle-video", "product-turntable", "turnaround", "expand-frame", "thumbnail", "miniature"];
  const own = cards.filter((card) => card.source === "project").slice(0, 8);
  const presets = featured.flatMap((id) => cards.filter((card) => card.source === "preset" && card.id === id));
  return (
    <section aria-label="Templates" className="mb-4 flex flex-col gap-2" data-studio-template-strip>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[13px] font-medium text-ink"><LayoutTemplate size={14} className="text-accent-text" aria-hidden="true" />Start from a template</h3>
        <button type="button" onClick={onBrowse} className="flex items-center gap-1 rounded-md px-1.5 text-[12.5px] text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60" title="All templates (T)">
          All templates<ArrowRight size={12} aria-hidden="true" />
        </button>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]">
        {[...own, ...presets].map((card) => (
          <TemplateTile key={`${card.source}:${card.id}`} card={card} compact onPick={() => {
            if (card.source === "preset") { const preset = STUDIO_PRESETS.find((entry) => entry.id === card.id); if (preset) onPick({ preset }); }
            else { const template = templates.find((entry) => entry._id === card.id); if (template) onPick({ template }); }
          }} />
        ))}
      </div>
    </section>
  );
}

/** The example files a generation started from, in its model's order, as far as Assets holds them. */
function exampleInputs(row: StudioGeneration, rows: readonly StudioGeneration[], model: StudioModel): Array<{ assetId: string; url: string; label: string }> {
  const first = model.needs[0];
  if (!first) return [];
  if (row.sourceAssetId) return [{ assetId: row.sourceAssetId, url: "", label: "Starting file" }];
  const parent = row.parentId ? rows.find((candidate) => candidate._id === row.parentId) : undefined;
  const saved = parent?.saved.find((entry) => entry.index === 0);
  return parent && saved && parent.outputs[0]?.kind === first ? [{ assetId: saved.assetId, url: parent.outputs[0].url, label: parent.prompt || parent.modelLabel }] : [];
}

/** Saves a finished generation as a template: name it, and turn the words people should change into [blanks]. */
export function SaveTemplateDialog({ projectId, row, rows, onSaved, onClose }: {
  projectId: string; row: StudioGeneration; rows: readonly StudioGeneration[]; onSaved?(id: string): void; onClose(): void;
}) {
  const model = studioModel(row.model);
  const [prompt, setPrompt] = useState(row.prompt);
  const [name, setName] = useState(() => templateName(row.prompt, row.modelLabel));
  const [description, setDescription] = useState("");
  const [label, setLabel] = useState("");
  const [keepInputs, setKeepInputs] = useState(true);
  const field = useRef<HTMLTextAreaElement>(null);
  const action = useAction();
  const examples = model ? exampleInputs(row, rows, model) : [];
  const blanks = model && promptTakesBlanks(model) ? templateBlanks(prompt) : [];
  const output = row.outputs[0];
  const settings = model ? settingsLine(model, templateFromGeneration(row).params) : row.modelLabel;

  const mark = () => {
    const start = field.current?.selectionStart ?? 0;
    const end = field.current?.selectionEnd ?? 0;
    if (start === end) { field.current?.focus(); return; }
    setPrompt(markBlank(prompt, start, end, label));
    setLabel("");
    window.setTimeout(() => field.current?.focus(), 0);
  };
  const save = () => {
    if (!model || !name.trim() || action.busy) return;
    void action.run(async () => {
      const id = await cloudMutation<string>("studioTemplates:save", {
        projectId, name, description, mode: row.mode, model: model.id, prompt, params: templateFromGeneration(row).params,
        sourceAssetIds: keepInputs ? examples.map((entry) => entry.assetId) : [], generationId: row._id,
      });
      onSaved?.(id);
      onClose();
    }, "Could not save the template");
  };

  return (
    <Modal title="Save as template" onClose={onClose} wide>
      <div className="flex flex-col gap-4 sm:flex-row" data-save-template onKeyDown={(event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); save(); } }}>
        <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-xl bg-inset sm:w-56">
          {output && <MediaThumb kind={output.kind} url={output.url} className="size-full" iconSize={24} />}
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3 pt-10 text-white">
            <span className="block truncate text-[13.5px] font-semibold">{name || "Untitled template"}</span>
            <span className="block truncate text-[11px] text-white/70">{settings}</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <Field label="Name">
            <input autoFocus className={inputClass} value={name} maxLength={STUDIO_TEMPLATE_NAME_MAX} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label="Prompt">
            <textarea ref={field} className={cn(inputClass, "min-h-[96px] resize-y font-[inherit] leading-relaxed")} rows={4} maxLength={8_000} value={prompt} aria-describedby="template-blank-help"
              onChange={(event) => setPrompt(event.target.value)} />
          </Field>
          {model && promptTakesBlanks(model) && (
            <div className="flex flex-col gap-2 rounded-xl border border-hairline/40 bg-inset/60 p-2.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <input className={cn(inputClass, "h-8 w-40 py-1 text-[12.5px]")} value={label} maxLength={32} onChange={(event) => setLabel(event.target.value)} placeholder="Name it (optional)" aria-label="Placeholder name" />
                <button type="button" className={cn(ghostButton, "h-8 min-h-8 px-2.5 text-[12.5px]")} disabled={!prompt.trim()} onMouseDown={(event) => event.preventDefault()} onClick={mark} data-make-placeholder>
                  <TextCursorInput size={13} />Make placeholder
                </button>
              </div>
              <p id="template-blank-help" className="text-[12px] leading-snug text-ink-tertiary">Select the words people should change, such as the product or the place, then make them a placeholder.</p>
              {blanks.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="Placeholders" data-template-blanks>
                  {blanks.map((blank, index) => (
                    <li key={`${blank.start}-${index}`} className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[12px] text-accent-text">
                      {blank.label ? <><span className="font-medium">{blank.label}</span>: </> : null}{blank.value || "empty"}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <Field label="Description (optional)">
            <input className={inputClass} value={description} maxLength={STUDIO_TEMPLATE_DESCRIPTION_MAX} onChange={(event) => setDescription(event.target.value)} placeholder={settings} />
          </Field>
          {examples.length > 0 && (
            <label className="flex items-center gap-2 text-[12.5px] text-ink-secondary">
              <input type="checkbox" checked={keepInputs} onChange={(event) => setKeepInputs(event.target.checked)} className="accent-[var(--color-accent)]" />
              Keep its starting {examples.length === 1 ? "file" : "files"} as {examples.length === 1 ? "an example" : "examples"} people can swap
            </label>
          )}
          {!model && <Notice tone="danger">Only generations made with one of Studio's models can become templates.</Notice>}
          {action.error && <Notice tone="danger">{action.error}</Notice>}
          <div className="mt-auto flex justify-end gap-2">
            <button type="button" className={ghostButton} onClick={onClose}>Cancel</button>
            <button type="button" className={primaryButton} disabled={!model || !name.trim() || action.busy} onClick={save}>
              {action.busy ? <Loader2 size={14} className="animate-spin" /> : <LayoutTemplate size={14} />}Save template
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
