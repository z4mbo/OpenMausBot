import { memo, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, Ban, Check, CircleDashed, FolderInput, FolderOutput, Loader2, Send, Type, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { inputClass } from "../origin-pages/ui";
import { KIND_ICON, MediaThumb } from "./studio-ui";
import { NODE_HEADER, NODE_WIDTH, PORT_ROW } from "./workflow-geometry";
import { STUDIO_CAMERA_MOTIONS, STUDIO_VOICES, studioModel, type StudioMediaKind, type StudioParams } from "../../../shared/studio";
import { STUDIO_BROADCAST_GROUPS, WORKFLOW_PALETTE, workflowNodeModel, workflowPorts, type StudioPort, type StudioRunNode, type StudioWorkflowNode } from "../../../shared/studio-workflow";

const PORT_COLOR: Record<StudioPort["kind"], string> = {
  text: "var(--color-ink-secondary)", image: "var(--color-accent)", video: "var(--color-success)", audio: "var(--color-warning)", any: "var(--color-ink-tertiary)",
};

export function portColor(kind: StudioPort["kind"]): string {
  return PORT_COLOR[kind];
}

function title(node: StudioWorkflowNode): string {
  if (node.type === "prompt") return String(node.params.label || "Prompt");
  if (node.type === "asset") return String(node.params.label || "Input file");
  if (node.type === "output") return "Output";
  return workflowNodeModel(node)?.label ?? "Model";
}

function StatusMark({ state }: { state?: StudioRunNode }) {
  if (!state) return null;
  const label = { waiting: "Waiting", running: "Running", done: "Done", failed: "Failed", skipped: "Skipped", cancelled: "Cancelled" }[state.status];
  const icon = state.status === "running" ? <Loader2 size={13} className="animate-spin text-accent-text" />
    : state.status === "done" ? <Check size={13} className="text-success" />
      : state.status === "failed" ? <AlertTriangle size={13} className="text-danger" />
        : state.status === "cancelled" ? <Ban size={13} className="text-ink-tertiary" /> : <CircleDashed size={13} className="text-ink-tertiary" />;
  return <span className="flex shrink-0 items-center" role="img" aria-label={label} title={state.error ?? label}>{icon}</span>;
}

type Props = {
  node: StudioWorkflowNode;
  selected: boolean;
  state?: StudioRunNode;
  problem?: string;
  canEdit: boolean;
  assetLabel?: { name: string; url: string };
  linked: ReadonlySet<string>;
  /** The project's library, for steps that can follow a character, product or style. */
  characters: readonly { id: string; name: string }[];
  onSelect(id: string, additive: boolean): void;
  /** `field` names what changed, so a burst of typing in one field undoes as one step. */
  onParams(id: string, params: StudioParams, field: string): void;
  onRemove(id: string): void;
  onDragStart(id: string, event: ReactPointerEvent): void;
  onPortDown(id: string, side: "in" | "out", port: StudioPort, event: ReactPointerEvent): void;
  onPickAsset(id: string, kind: StudioMediaKind): void;
};

const select = "w-full [&_select]:w-full";

function ModelSettings({ node, disabled, characters, set }: { node: StudioWorkflowNode; disabled: boolean; characters: Props["characters"]; set(patch: StudioParams): void }) {
  const model = workflowNodeModel(node);
  const value = (key: string, allowed: readonly string[] | undefined) => (allowed?.includes(String(node.params[key] ?? "")) ? String(node.params[key]) : allowed?.[0] ?? "");
  return (
    <>
      <Select size="sm" className={select} aria-label="Model" value={String(node.params.model ?? "")} disabled={disabled} onChange={(event) => set({ model: event.target.value })}>
        {WORKFLOW_PALETTE.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.models.map((id) => <option key={id} value={id}>{studioModel(id)!.label}</option>)}
          </optgroup>
        ))}
      </Select>
      {model && model.prompt !== "none" && (
        <textarea className={cn(inputClass, "resize-none text-[12px]")} rows={2} maxLength={8_000} aria-label="Node prompt" disabled={disabled}
          placeholder={model.prompt === "required" ? "Prompt, or link a Prompt node" : "Prompt (optional)"} value={String(node.params.prompt ?? "")} onChange={(event) => set({ prompt: event.target.value })} />
      )}
      {model && (model.aspectRatios || model.durations || model.resolutions || model.voices || model.motion) && (
        <div className="grid grid-cols-2 gap-1.5">
          {model.aspectRatios && <Select size="sm" className={select} aria-label="Aspect ratio" value={value("aspectRatio", model.aspectRatios)} disabled={disabled} onChange={(event) => set({ aspectRatio: event.target.value })}>{model.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</Select>}
          {model.durations && <Select size="sm" className={select} aria-label="Duration" value={value("duration", model.durations)} disabled={disabled} onChange={(event) => set({ duration: event.target.value })}>{model.durations.map((entry) => <option key={entry} value={entry}>{entry.endsWith("s") ? entry : `${entry}s`}</option>)}</Select>}
          {model.resolutions && <Select size="sm" className={select} aria-label="Resolution" value={value("resolution", model.resolutions)} disabled={disabled} onChange={(event) => set({ resolution: event.target.value })}>{model.resolutions.map((entry) => <option key={entry} value={entry}>{entry}</option>)}</Select>}
          {model.voices && <Select size="sm" className={select} aria-label="Voice" value={value("voice", model.voices)} disabled={disabled} onChange={(event) => set({ voice: event.target.value })}>{STUDIO_VOICES.map((voice) => <option key={voice.name} value={voice.name}>{voice.name}</option>)}</Select>}
          {model.motion && <Select size="sm" className={select} aria-label="Camera motion" value={String(node.params.motion ?? "")} disabled={disabled} onChange={(event) => set({ motion: event.target.value })}><option value="">Free camera</option>{STUDIO_CAMERA_MOTIONS.map((motion) => <option key={motion.id} value={motion.id}>{motion.label}</option>)}</Select>}
        </div>
      )}
      {model && model.kind !== "audio" && !model.needs.includes("video") && (characters.length > 0 || node.params.character) && (
        <Select size="sm" className={select} aria-label="Library" value={String(node.params.character ?? "")} disabled={disabled} onChange={(event) => set({ character: event.target.value })}>
          <option value="">No character or style</option>
          {characters.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          {node.params.character && !characters.some((entry) => entry.id === node.params.character) && <option value={String(node.params.character)}>Removed entry</option>}
        </Select>
      )}
    </>
  );
}

/** One workflow node: header to drag, a row per port, then its own settings and, after a run, its output. */
export const WorkflowNodeCard = memo(function WorkflowNodeCard({ node, selected, state, problem, canEdit, assetLabel, linked, characters, onSelect, onParams, onRemove, onDragStart, onPortDown, onPickAsset }: Props) {
  const { inputs, outputs } = workflowPorts(node);
  const rows = Math.max(inputs.length, outputs.length);
  const model = workflowNodeModel(node);
  const kind = (node.type === "asset" ? String(node.params.kind || "image") : model?.kind ?? "image") as StudioMediaKind;
  const Icon = node.type === "prompt" ? Type : node.type === "output" ? FolderOutput : node.type === "asset" ? FolderInput : KIND_ICON[kind];
  const set = (patch: StudioParams) => onParams(node.id, { ...node.params, ...patch }, Object.keys(patch).join(","));
  const group = node.type === "output" ? String(node.params.broadcast ?? "") : "";
  return (
    <div role="group" aria-label={`${title(node)} node`} data-workflow-node={node.id} tabIndex={0}
      onPointerDown={(event) => onSelect(node.id, event.shiftKey)} onFocus={() => onSelect(node.id, false)}
      className={cn("absolute flex flex-col rounded-xl border bg-panel text-[12px] outline-none", selected ? "border-accent" : problem ? "border-danger/60" : "border-hairline/60")}
      style={{ left: node.x, top: node.y, width: NODE_WIDTH }}>
      <div className="flex cursor-grab items-center gap-2 rounded-t-xl border-b border-hairline/40 bg-raised/40 px-2.5 active:cursor-grabbing" style={{ height: NODE_HEADER }}
        onPointerDown={(event) => onDragStart(node.id, event)}>
        <Icon size={13} className="shrink-0 text-ink-secondary" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-medium text-ink">{title(node)}</span>
        <StatusMark state={state} />
        {canEdit && (
          <button type="button" className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary hover:bg-raised hover:text-ink" aria-label={`Remove ${title(node)}`}
            onPointerDown={(event) => event.stopPropagation()} onClick={() => onRemove(node.id)}><X size={12} /></button>
        )}
      </div>
      <div className="relative" style={{ height: rows * PORT_ROW }}>
        {inputs.map((port, index) => (
          <div key={port.id} className="absolute left-0 flex items-center gap-1.5 pl-3 text-ink-secondary" style={{ top: index * PORT_ROW, height: PORT_ROW }}>
            <button type="button" data-port-in={port.id} data-port-node={node.id} aria-label={`${port.label} input`} disabled={!canEdit}
              onPointerDown={(event) => onPortDown(node.id, "in", port, event)}
              className="absolute -left-[7px] size-3.5 rounded-full border-2 border-panel outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              style={{ background: linked.has(`in:${port.id}`) ? portColor(port.kind) : "var(--color-inset)", boxShadow: `inset 0 0 0 1.5px ${portColor(port.kind)}` }} />
            <span>{port.label}{port.required && !linked.has(`in:${port.id}`) ? " ·" : ""}</span>
          </div>
        ))}
        {outputs.map((port, index) => (
          <div key={port.id} className="absolute right-0 flex items-center gap-1.5 pr-3 text-ink-secondary" style={{ top: index * PORT_ROW, height: PORT_ROW }}>
            <span>{port.label}</span>
            <button type="button" data-port-out={port.id} data-port-node={node.id} aria-label={`${port.label} output`} disabled={!canEdit}
              onPointerDown={(event) => onPortDown(node.id, "out", port, event)}
              className="absolute -right-[7px] size-3.5 rounded-full border-2 border-panel outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              style={{ background: portColor(port.kind) }} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-1.5 px-2.5 pb-2.5 pt-1" onPointerDown={(event) => event.stopPropagation()}>
        {node.type === "prompt" && (
          <>
            <input className={cn(inputClass, "py-1 text-[12px]")} aria-label="Prompt name" value={String(node.params.label ?? "")} placeholder="Name" maxLength={40} disabled={!canEdit} onChange={(event) => set({ label: event.target.value })} />
            <textarea className={cn(inputClass, "resize-none text-[12px]")} rows={3} maxLength={8_000} aria-label="Prompt text" disabled={!canEdit} value={String(node.params.text ?? "")} onChange={(event) => set({ text: event.target.value })} />
          </>
        )}
        {node.type === "asset" && (
          <>
            <Select size="sm" className={select} aria-label="File kind" value={kind} disabled={!canEdit} onChange={(event) => set({ kind: event.target.value, assetId: "" })}>
              <option value="image">Image</option><option value="video">Video</option><option value="audio">Audio</option>
            </Select>
            <button type="button" disabled={!canEdit} onClick={() => onPickAsset(node.id, kind)}
              className="flex items-center gap-2 rounded-lg border border-dashed border-hairline bg-inset p-1.5 text-left text-ink-secondary hover:border-accent/60 hover:text-ink">
              {assetLabel ? <MediaThumb kind={kind} url={assetLabel.url} className="size-9 shrink-0 rounded-md" /> : null}
              <span className="min-w-0 flex-1 truncate">{assetLabel?.name ?? (node.params.assetId ? "Chosen file" : "Choose from Assets")}</span>
            </button>
          </>
        )}
        {node.type === "model" && <ModelSettings node={node} disabled={!canEdit} characters={characters} set={set} />}
        {node.type === "output" && (
          <>
            <input className={cn(inputClass, "py-1 text-[12px]")} aria-label="Asset name" placeholder="Asset name" maxLength={120} disabled={!canEdit} value={String(node.params.name ?? "")} onChange={(event) => set({ name: event.target.value })} />
            <Select size="sm" className={select} aria-label="Broadcast" value={group} disabled={!canEdit} onChange={(event) => set({ broadcast: event.target.value })}>
              <option value="">Assets only</option>
              {Object.entries(STUDIO_BROADCAST_GROUPS).map(([value, entry]) => <option key={value} value={value}>{`Also draft a ${entry.label.toLowerCase()}`}</option>)}
            </Select>
          </>
        )}
        {state?.output && node.type !== "prompt" && (
          <a href={state.output.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg bg-inset" aria-label="Open this step's output">
            {state.output.kind === "audio" ? <audio src={state.output.url} controls preload="none" className="h-8 w-full [color-scheme:var(--code-color-scheme)]" /> : <MediaThumb kind={state.output.kind} url={state.output.url} className="h-16 w-full" />}
          </a>
        )}
        {state?.status === "failed" && state.error && <p className="line-clamp-3 text-[11.5px] text-danger">{state.error}</p>}
        {!state && problem && <p className="text-[11.5px] text-danger">{problem}</p>}
        {node.type === "output" && state?.status === "done" && <p className="text-[11.5px] text-success">Saved to Assets</p>}
        {group && !state && <p className="flex items-center gap-1 text-[11.5px] text-ink-tertiary"><Send size={11} aria-hidden="true" />Drafted in Broadcast after a run</p>}
      </div>
    </div>
  );
});
