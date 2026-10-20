import { useState } from "react";
import { Check, Copy, Play } from "lucide-react";
import { nodeCss, nodeReact, nodeTailwind } from "../../../../shared/canvas-code";
import { TRANSITIONS, effectiveParent, type CanvasNode, type PrototypeLink } from "../../../../shared/canvas-scene";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/cn";
import { Select } from "../../Select";
import type { SelectionApi } from "./CanvasEditor";
import { Section, iconToggle } from "./controls";
import type { CanvasScene } from "./use-canvas-scene";

export type InspectorTab = "design" | "prototype" | "code";

export function TabBar({ tab, onTab }: { tab: InspectorTab; onTab(tab: InspectorTab): void }) {
  return (
    <div role="tablist" aria-label="Inspector" className="flex h-10 shrink-0 items-center gap-0.5 border-b border-hairline/40 px-2">
      {(["design", "prototype", "code"] as const).map((item) => (
        <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => onTab(item)}
          className={cn("h-7 rounded-md px-2.5 text-[12px] font-medium outline-none transition-colors duration-(--motion-fast) focus-visible:ring-2 focus-visible:ring-accent/60",
            tab === item ? "bg-raised text-ink" : "text-ink-secondary hover:text-ink")}>
          {item === "design" ? "Design" : item === "prototype" ? "Prototype" : "Code"}
        </button>
      ))}
    </div>
  );
}

const TRANSITION_NAMES = { instant: "Instant", dissolve: "Dissolve", slide: "Slide in" } as const;

/** Where a click on the selection leads in Present mode. */
export function PrototypePanel({ canvas, selection, readOnly, onPresent }: { canvas: CanvasScene; selection: SelectionApi; readOnly: boolean; onPresent(frameId: string | null): void }) {
  const frames = (canvas.index.get(null) ?? []).filter((node) => node.type === "frame" && !node.hidden);
  const nodes = selection.nodes;
  const single = nodes.length === 1 ? nodes[0]! : null;
  const start = single ? (effectiveParent(canvas.scene, single) ? frames.find((frame) => isInside(canvas, single, frame.id)) : single.type === "frame" ? single : undefined) : frames[0];
  const update = (patch: Partial<CanvasNode>) => canvas.commit(nodes.filter((node) => !node.locked).map((node) => ({ ...node, ...patch })));
  const link = single?.prototype;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {single ? (
        <Section title="Interaction">
          <label className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-[12px] text-ink-secondary">On click
            <Select size="sm" aria-label="Navigate to" disabled={readOnly} value={link?.to ?? ""} onChange={(event) => update({ prototype: event.target.value ? { to: event.target.value, transition: link?.transition ?? "dissolve" } : undefined })}>
              <option value="">Nothing</option>
              {frames.filter((frame) => frame.id !== single.id).map((frame) => <option key={frame.id} value={frame.id}>Go to {frame.name}</option>)}
            </Select>
          </label>
          {link && (
            <label className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-[12px] text-ink-secondary">Animation
              <Select size="sm" aria-label="Transition" disabled={readOnly} value={link.transition} onChange={(event) => update({ prototype: { ...link, transition: event.target.value as PrototypeLink["transition"] } })}>
                {TRANSITIONS.map((item) => <option key={item} value={item}>{TRANSITION_NAMES[item]}</option>)}
              </Select>
            </label>
          )}
        </Section>
      ) : <p className="px-3 py-3 text-[12px] text-ink-tertiary">Select a layer to link it to another frame.</p>}
      <Section title="Present">
        <button type="button" disabled={!frames.length} onClick={() => onPresent(start?.id ?? null)}
          className={cn(iconToggle, "h-8 gap-1.5 bg-inset text-[12px] text-ink")}><Play size={13} />Present {start ? start.name : "from the first frame"}</button>
        <p className="text-[11.5px] text-ink-tertiary">Ctrl+Alt+Enter. Arrows step through frames; Esc leaves.</p>
      </Section>
    </div>
  );
}

function isInside(canvas: CanvasScene, node: CanvasNode, frameId: string): boolean {
  let parent = effectiveParent(canvas.scene, node);
  while (parent) { if (parent === frameId) return true; parent = effectiveParent(canvas.scene, canvas.scene.get(parent)!); }
  return false;
}

/** CSS, Tailwind and React for the selection, ready to copy. */
export function DevPanel({ canvas, selection }: { canvas: CanvasScene; selection: SelectionApi }) {
  const [format, setFormat] = useState<"css" | "tailwind" | "react">("react");
  const [copied, setCopied] = useState(false);
  const single = selection.nodes.length === 1 ? selection.nodes[0]! : null;
  if (!single) return <p className="px-3 py-3 text-[12px] text-ink-tertiary">Select one layer to see its code.</p>;
  const code = format === "css" ? nodeCss(canvas.scene, single) : format === "tailwind" ? nodeTailwind(canvas.scene, single) : nodeReact(canvas.scene, single);
  const copy = async () => { await copyText(code); setCopied(true); window.setTimeout(() => setCopied(false), 1200); };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-1.5">
        <div role="group" aria-label="Code format" className="flex flex-1 gap-0.5 rounded-md bg-inset p-0.5">
          {(["react", "tailwind", "css"] as const).map((item) => (
            <button key={item} type="button" aria-pressed={format === item} onClick={() => setFormat(item)} className={cn(iconToggle, "h-6 text-[11.5px]", format === item && "bg-raised text-ink")}>
              {item === "react" ? "React" : item === "tailwind" ? "Tailwind" : "CSS"}
            </button>
          ))}
        </div>
        <button type="button" className={cn(iconToggle, "max-w-7 flex-none")} aria-label="Copy code" title="Copy" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      </div>
      <pre aria-label="Generated code" className="min-h-0 flex-1 overflow-auto rounded-md bg-inset p-2 text-[11.5px] leading-[1.5] text-ink-secondary [tab-size:2]"><code>{code}</code></pre>
      <p className="text-[11.5px] text-ink-tertiary">{Math.round(single.width)} × {Math.round(single.height)} · {single.name}</p>
    </div>
  );
}
