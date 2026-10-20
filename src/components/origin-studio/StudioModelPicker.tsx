import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Modal, inputClass } from "../origin-pages/ui";
import { KIND_ICON, MediaThumb, formatSeconds } from "./studio-ui";
import { STUDIO_MODELS, studioEta, type StudioGeneration, type StudioMode, type StudioModel } from "../../../shared/studio";

const MODE_LABEL: Record<StudioMode, string> = { image: "Image", video: "Video", audio: "Audio", edit: "Edit" };
const MODE_ORDER: readonly StudioMode[] = ["image", "video", "audio", "edit"];

function traits(model: StudioModel): string[] {
  const list: string[] = [];
  if (model.needs.length) list.push(`from ${model.needs.join(" + ")}`);
  if (model.references) list.push(`${model.references} refs`);
  if (model.sound) list.push("sound");
  if (model.resolutions?.length) list.push(`up to ${model.resolutions.at(-1)}`);
  if (model.durations?.length && model.kind === "video") list.push(`${model.durations.at(-1)!.replace(/s$/, "")}s`);
  return list;
}

/** Every Studio model as a card: the project's latest output with it, what it is good at and how long it usually takes. */
export function StudioModelPicker({ mode, current, rows, onPick, onClose }: { mode: StudioMode; current: string; rows: readonly StudioGeneration[]; onPick(model: StudioModel): void; onClose(): void }) {
  const [query, setQuery] = useState("");
  const grid = useRef<HTMLDivElement>(null);
  const latest = useMemo(() => {
    const found = new Map<string, string>();
    for (const row of rows) if (row.status === "done" && row.outputs[0] && !found.has(row.model)) found.set(row.model, row.outputs[0].url);
    return found;
  }, [rows]);
  const needle = query.trim().toLowerCase();
  const groups = [mode, ...MODE_ORDER.filter((other) => other !== mode)].map((group) => ({
    group, models: STUDIO_MODELS.filter((model) => model.mode === group && (!needle || `${model.label} ${model.description} ${model.id}`.toLowerCase().includes(needle))),
  })).filter((entry) => entry.models.length);

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const cards = [...(grid.current?.querySelectorAll<HTMLButtonElement>("[data-model-card]") ?? [])];
    const at = cards.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0 || !["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) return;
    event.preventDefault();
    const here = cards[at]!.getBoundingClientRect();
    let target = at + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const down = event.key === "ArrowDown";
      const row = cards.filter((card) => (down ? card.getBoundingClientRect().top > here.top + 4 : card.getBoundingClientRect().top < here.top - 4));
      const nearest = (down ? row : row.reverse()).filter((card, _, all) => Math.abs(card.getBoundingClientRect().top - all[0]!.getBoundingClientRect().top) < 4)
        .sort((a, b) => Math.abs(a.getBoundingClientRect().left - here.left) - Math.abs(b.getBoundingClientRect().left - here.left))[0];
      target = nearest ? cards.indexOf(nearest) : at;
    }
    cards[Math.min(Math.max(target, 0), cards.length - 1)]?.focus();
  };

  return (
    <Modal title="Models" onClose={onClose} wide>
      <label className="relative mb-3 flex items-center">
        <Search size={14} className="pointer-events-none absolute left-2.5 text-ink-tertiary" aria-hidden="true" />
        <input autoFocus className={cn(inputClass, "pl-8")} placeholder="Search models" aria-label="Search models" value={query} onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "Enter") {
              event.preventDefault();
              grid.current?.querySelector<HTMLButtonElement>("[data-model-card]")?.[event.key === "Enter" ? "click" : "focus"]();
            }
          }} />
      </label>
      <div ref={grid} onKeyDown={move} className="flex max-h-[62vh] flex-col gap-4 overflow-y-auto pb-1" data-studio-models>
        {groups.map(({ group, models }) => (
          <section key={group} aria-label={MODE_LABEL[group]}>
            <h4 className="mb-2 text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-tertiary">{MODE_LABEL[group]}</h4>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,196px),1fr))] gap-2">
              {models.map((model) => {
                const Icon = KIND_ICON[model.kind];
                const thumb = latest.get(model.id);
                return (
                  <button key={model.id} type="button" data-model-card aria-pressed={model.id === current} onClick={() => onPick(model)}
                    className={cn("group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-inset text-left outline-none transition-colors duration-(--motion-fast) hover:border-hairline focus-visible:border-accent",
                      model.id === current ? "border-accent/70" : "border-hairline/40")}>
                    <span className="relative flex h-24 items-center justify-center overflow-hidden bg-raised/40">
                      {thumb ? <MediaThumb kind={model.kind} url={thumb} className="size-full" iconSize={22} /> : <Icon size={22} className="text-ink-tertiary" aria-hidden="true" />}
                      <span className="absolute bottom-1.5 right-1.5 rounded-full bg-app/85 px-1.5 py-0.5 text-[10.5px] tabular-nums text-ink-secondary">~{formatSeconds(studioEta(model.id, rows))}</span>
                    </span>
                    <span className="flex min-w-0 flex-col gap-1 p-2.5">
                      <span className="truncate text-[13px] font-medium text-ink">{model.label}</span>
                      <span className="line-clamp-2 text-[11.5px] leading-snug text-ink-secondary">{model.description}</span>
                      {traits(model).length > 0 && <span className="truncate text-[11px] text-ink-tertiary">{traits(model).join(" · ")}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
        {!groups.length && <p className="py-8 text-center text-[13px] text-ink-tertiary">No model matches “{query}”.</p>}
      </div>
    </Modal>
  );
}
