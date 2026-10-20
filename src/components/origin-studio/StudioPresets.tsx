import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal, inputClass } from "../origin-pages/ui";
import { KIND_ICON, type StudioDraft } from "./studio-ui";
import { draftForModel, emptyDraft } from "./StudioComposer";
import { STUDIO_PRESETS, STUDIO_PRESET_GROUPS, studioPresetModel, type StudioPreset } from "../../../shared/studio-presets";

const IMAGES = import.meta.glob<string>("../../assets/studio-presets/*.webp", { eager: true, query: "?url", import: "default" });

export function presetImage(id: string): string | undefined {
  return IMAGES[`../../assets/studio-presets/${id}.webp`];
}

/** The prompt bar set up for a preset: its model, settings and starting prompt, keeping files that still fit. */
export function draftForPreset(draft: StudioDraft, preset: StudioPreset): StudioDraft {
  const model = studioPresetModel(preset);
  const base = draftForModel(draft.mode === model.mode ? draft : emptyDraft(model.mode), model);
  return {
    ...base, preset: preset.id, prompt: preset.prompt ?? "", parent: undefined,
    aspectRatio: preset.aspectRatio, duration: preset.duration, resolution: preset.resolution, motion: preset.motion, angle: preset.angle,
    ...(preset.sound === false ? { sound: false } : { sound: undefined }),
  };
}

function inputsOf(preset: StudioPreset): string {
  const model = studioPresetModel(preset);
  const labels = model.needs.map((kind, index) => model.inputLabels?.[index] ?? `${kind[0]!.toUpperCase()}${kind.slice(1)}`);
  return labels.length ? labels.join(" + ") : "Prompt";
}

export function PresetTile({ preset, current, onPick, compact }: { preset: StudioPreset; current?: boolean; onPick(): void; compact?: boolean }) {
  const model = studioPresetModel(preset);
  const Icon = KIND_ICON[model.kind];
  const image = presetImage(preset.id);
  return (
    <button type="button" data-preset-card={preset.id} aria-pressed={current} onClick={onPick} title={preset.description}
      className={cn("group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-inset text-left outline-none transition-colors duration-(--motion-fast) hover:border-hairline focus-visible:border-accent",
        current ? "border-accent/70" : "border-hairline/40", compact && "w-36 shrink-0")}>
      <span className={cn("relative block overflow-hidden bg-raised/40", compact ? "h-20" : "aspect-[4/3]")}>
        {image
          ? <img src={image} alt="" loading="lazy" draggable={false} className="size-full object-cover transition-transform duration-(--motion-fast) group-hover:scale-[1.03]" />
          : <Icon size={22} className="m-auto text-ink-tertiary" aria-hidden="true" />}
        <span className="absolute bottom-1.5 left-1.5 flex size-5 items-center justify-center rounded-full bg-app/85 text-ink-secondary" aria-hidden="true"><Icon size={11} /></span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5 p-2">
        <span className="truncate text-[12.5px] font-medium text-ink">{preset.label}</span>
        {!compact && <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-secondary">{preset.description}</span>}
        {!compact && <span className="truncate text-[11px] text-ink-tertiary">{inputsOf(preset)}</span>}
      </span>
    </button>
  );
}

/** Every preset as a picture card, grouped like Higgsfield's apps; arrows move, Enter picks. */
export function StudioPresetGallery({ current, onPick, onClose }: { current?: string; onPick(preset: StudioPreset): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => STUDIO_PRESET_GROUPS.map((group) => ({
    ...group,
    presets: STUDIO_PRESETS.filter((preset) => preset.group === group.value && (!needle || `${preset.label} ${preset.description} ${studioPresetModel(preset).label}`.toLowerCase().includes(needle))),
  })).filter((group) => group.presets.length), [needle]);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(grid.current?.querySelectorAll<HTMLButtonElement>("[data-preset-card]") ?? [])];
    const at = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const columns = Math.max(1, Math.round((grid.current?.clientWidth ?? 600) / (cards[0]?.offsetWidth ?? 180)));
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? columns : -columns;
    cards[Math.min(Math.max(at + step, 0), cards.length - 1)]?.focus();
  };

  return (
    <Modal title="Presets" onClose={onClose} wide>
      <label className="relative mb-3 flex items-center">
        <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
        <input autoFocus className={cn(inputClass, "pl-8")} placeholder="Search presets" aria-label="Search presets" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              grid.current?.querySelector<HTMLButtonElement>("[data-preset-card]")?.[event.key === "Enter" ? "click" : "focus"]();
            }
          }} />
      </label>
      <div ref={grid} onKeyDown={move} className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pb-1" data-studio-presets>
        {groups.map((group) => (
          <section key={group.value} aria-label={group.label}>
            <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{group.label}</h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,168px),1fr))] gap-2">
              {group.presets.map((preset) => <PresetTile key={preset.id} preset={preset} current={preset.id === current} onPick={() => onPick(preset)} />)}
            </div>
          </section>
        ))}
        {!groups.length && <p className="py-8 text-center text-[13px] text-ink-tertiary">No preset matches “{query}”.</p>}
      </div>
      <p className="mt-3 text-[11px] text-ink-tertiary">Preview images from ComfyUI's workflow templates, © Comfy Org, MIT License.</p>
    </Modal>
  );
}

/** A scrolling row of presets for an empty canvas. */
export function PresetStrip({ onPick, onMore }: { onPick(preset: StudioPreset): void; onMore(): void }) {
  const featured = ["motion-transfer", "character-swap", "virtual-try-on", "camera-angle", "relight", "start-end-frame", "restyle-video", "product-turntable", "turnaround", "expand-frame"];
  return (
    <section aria-label="Presets" className="flex flex-col gap-2" data-studio-preset-strip>
      <div className="flex items-baseline justify-between">
        <h3 className="text-[12px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">Start from a preset</h3>
        <button type="button" onClick={onMore} className="rounded-md px-1.5 text-[12.5px] text-ink-secondary outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60">All presets</button>
      </div>
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        {featured.flatMap((id) => STUDIO_PRESETS.filter((preset) => preset.id === id)).map((preset) => <PresetTile key={preset.id} preset={preset} compact onPick={() => onPick(preset)} />)}
      </div>
    </section>
  );
}
