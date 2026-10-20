import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { AudioLines, Clapperboard, Image as ImageIcon, ImagePlus, KeyRound, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { api, useStore } from "@/state/store";
import { useCloudQuery } from "@/lib/origin-cloud";
import { useBrandKit } from "@/lib/origin-brand";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import { requestIntegrationFocus } from "../IntegrationKeysSettings";
import type { CloudDesign, CloudDesignAsset } from "../origin-pages/cloud-types";
import { EmptyState, Modal, Notice, Segmented, cardClass, chipButton, ghostButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { STUDIO_CUSTOM_MODEL, studioModel, studioModelsFor, type StudioMode } from "../../../shared/studio";
import { brandedPrompt, type BrandKit } from "../../../shared/brand-kit";

function BrandToggle({ kit, on, disabled, onChange }: { kit: BrandKit; on: boolean; disabled: boolean; onChange(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} title={`Prompts start with: ${brandedPrompt(kit, "").trim()}`}
      className={cn(chipButton, "ml-auto", on ? "border-accent/50 text-ink" : "text-ink-tertiary")}>
      <span className={cn("flex transition-opacity duration-(--motion-fast)", !on && "opacity-40")} aria-hidden="true">
        <span className="size-3 rounded-full ring-2 ring-panel" style={{ background: kit.colors.primary }} />
        <span className="-ml-1 size-3 rounded-full ring-2 ring-panel" style={{ background: kit.colors.secondary }} />
      </span>
      Use brand
    </button>
  );
}

/** A finished generation's settings, put back into the composer to run again. */
export type StudioDraft = { mode: StudioMode; model: string; prompt: string; aspectRatio?: string; duration?: string; sourceAssetId?: string };

const MODES = [
  { value: "image", label: <><ImageIcon size={13} />Image</> },
  { value: "video", label: <><Clapperboard size={13} />Video</> },
  { value: "audio", label: <><AudioLines size={13} />Audio</> },
  { value: "edit", label: <><Wand2 size={13} />Edit</> },
] as const;

const PLACEHOLDER: Record<StudioMode, string> = {
  image: "Describe the image",
  video: "Describe the shot and how it moves",
  audio: "Words to speak, or the music or sound you want",
  edit: "How to change it (optional for upscales)",
};

const isImageAsset = (asset: CloudDesignAsset) => asset.type === "image" || asset.type === "icon" || Boolean(asset.contentType?.startsWith("image/"));
const assetLink = (asset: CloudDesignAsset) => asset.fileUrl || asset.url || "";

export function openFalSettings(dispatch: ReturnType<typeof useStore>["dispatch"]) {
  requestIntegrationFocus("fal");
  dispatch({ type: "toggleAppSettings", open: true, section: "integrations" });
}

export function StudioComposer({ projectId, canEdit, falReady, draft }: { projectId: string; canEdit: boolean; falReady: boolean | null; draft: StudioDraft | null }) {
  const { dispatch } = useStore();
  const [mode, setMode] = useState<StudioMode>("image");
  const [model, setModel] = useState(studioModelsFor("image")[0]!.id);
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("");
  const [duration, setDuration] = useState("");
  const [voice, setVoice] = useState("");
  const [count, setCount] = useState(1);
  const [useBrand, setUseBrand] = useState(true);
  const brand = useBrandKit(projectId);
  const [source, setSource] = useState<CloudDesignAsset | null>(null);
  const [picking, setPicking] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [inputJson, setInputJson] = useState("");
  const action = useAction();
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  const images = design?.assets.filter(isImageAsset) ?? [];
  const custom = model === STUDIO_CUSTOM_MODEL;
  const spec = custom ? undefined : studioModel(model);
  const needsSource = spec?.source === "image";

  const switchMode = (next: StudioMode) => {
    setMode(next);
    setModel(studioModelsFor(next)[0]!.id);
    setCount(1);
    action.setError("");
  };

  const applied = useRef<StudioDraft | null>(null);
  useEffect(() => {
    if (!draft || applied.current === draft) return;
    applied.current = draft;
    setMode(draft.mode);
    setModel(draft.model);
    setPrompt(draft.prompt);
    setAspectRatio(draft.aspectRatio ?? "");
    setDuration(draft.duration ?? "");
    setSource(draft.sourceAssetId ? design?.assets.find((asset) => asset._id === draft.sourceAssetId) ?? null : null);
    promptRef.current?.focus();
  }, [draft, design]);

  const parsedInput = (): Record<string, unknown> | undefined => {
    if (!custom || !inputJson.trim()) return undefined;
    const value = JSON.parse(inputJson) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The input must be a JSON object");
    return value as Record<string, unknown>;
  };

  const generate = () => {
    if (!canEdit || action.busy || !falReady) return;
    void action.run(async () => {
      const input = parsedInput();
      await api("/api/studio/generate", {
        method: "POST",
        body: JSON.stringify({
          projectId, mode, model, prompt, count,
          ...(aspectRatio ? { aspectRatio } : {}), ...(duration ? { duration } : {}), ...(voice ? { voice } : {}),
          ...(source && (needsSource || custom) ? { sourceAssetId: source._id } : {}),
          ...(custom ? { endpoint, ...(input ? { input } : {}) } : {}),
          ...(brand ? { brand: useBrand } : {}),
        }),
      });
    }, "Could not start the generation");
  };

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      generate();
    }
  };

  const ready = canEdit && falReady === true && (prompt.trim() || spec?.family === "upscale" || (custom && inputJson.trim())) && (!needsSource || source) && (!custom || endpoint.trim());

  return (
    <div className={cn(cardClass, "mb-5 flex flex-col gap-3 p-3")} data-studio-composer>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="What to make" value={mode} onChange={switchMode} options={MODES} />
        {(needsSource || custom) && (
          source ? (
            <span className={cn(chipButton, "pr-1")}>
              <img src={assetLink(source)} alt="" className="size-5 rounded object-cover" />
              <span className="truncate">{source.name}</span>
              <button type="button" aria-label="Remove the starting image" onClick={() => setSource(null)} className="flex size-6 items-center justify-center rounded-full hover:bg-raised"><X size={12} /></button>
            </span>
          ) : (
            <button type="button" className={chipButton} onClick={() => setPicking(true)} disabled={!canEdit}>
              <ImagePlus size={14} />{needsSource ? "Choose a starting image" : "Starting image (optional)"}
            </button>
          )
        )}
        {brand && (mode === "image" || mode === "video") && <BrandToggle kit={brand} on={useBrand} disabled={!canEdit} onChange={setUseBrand} />}
      </div>
      <textarea ref={promptRef} value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={onKey} disabled={!canEdit}
        rows={3} maxLength={8_000} aria-label="Prompt" placeholder={PLACEHOLDER[mode]}
        className="min-h-[76px] w-full resize-y rounded-lg bg-inset px-3 py-2.5 text-[14px] leading-relaxed text-ink outline-none placeholder:text-ink-tertiary focus-visible:ring-1 focus-visible:ring-accent/50 disabled:opacity-60 max-md:text-[16px]" />
      {custom && (
        <div className="grid gap-2 md:grid-cols-[1fr_2fr]">
          <input className={inputClass} value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="fal endpoint, such as owner/app/path" aria-label="fal endpoint" spellCheck={false} />
          <textarea className={cn(inputClass, "font-mono text-[12px]")} rows={2} value={inputJson} onChange={(event) => setInputJson(event.target.value)}
            placeholder='Input JSON, such as {"workflow": …}' aria-label="Input JSON" spellCheck={false} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Select variant="pill" size="sm" aria-label="Model" value={model} onChange={(event) => { setModel(event.target.value); setCount(1); }} disabled={!canEdit}>
          {studioModelsFor(mode).map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          <option value={STUDIO_CUSTOM_MODEL}>Custom fal endpoint</option>
        </Select>
        {spec?.aspectRatios && (
          <Select variant="pill" size="sm" aria-label="Aspect ratio" value={spec.aspectRatios.includes(aspectRatio) ? aspectRatio : spec.aspectRatios[0]} onChange={(event) => setAspectRatio(event.target.value)} disabled={!canEdit}>
            {spec.aspectRatios.map((ratio) => <option key={ratio} value={ratio}>{ratio === "auto" ? "Auto ratio" : ratio}</option>)}
          </Select>
        )}
        {spec?.durations && (
          <Select variant="pill" size="sm" aria-label="Duration" value={spec.durations.includes(duration) ? duration : spec.durations[0]} onChange={(event) => setDuration(event.target.value)} disabled={!canEdit}>
            {spec.durations.map((value) => <option key={value} value={value}>{value.endsWith("s") ? value : `${value}s`}</option>)}
          </Select>
        )}
        {spec?.voices && (
          <Select variant="pill" size="sm" aria-label="Voice" value={voice || spec.voices[0]} onChange={(event) => setVoice(event.target.value)} disabled={!canEdit}>
            {spec.voices.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        )}
        {(spec?.maxCount ?? 4) > 1 && (
          <Select variant="pill" size="sm" aria-label="Variations" value={String(count)} onChange={(event) => setCount(Number(event.target.value))} disabled={!canEdit}>
            {Array.from({ length: spec?.maxCount ?? 4 }, (_, index) => <option key={index} value={index + 1}>{index + 1} ×</option>)}
          </Select>
        )}
        <div className="ml-auto flex items-center gap-2">
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
      {action.error && <Notice tone="danger">{action.error}</Notice>}
      {picking && (
        <Modal title="Choose a starting image" onClose={() => setPicking(false)} wide>
          {!images.length ? <EmptyState compact icon={<ImageIcon size={22} />} title="No images in Assets yet" body="Generate an image and save it to Assets, or upload one there." /> : (
            <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 overflow-y-auto">
              {images.map((asset) => (
                <button key={asset._id} type="button" onClick={() => { setSource(asset); setPicking(false); }}
                  className="group flex flex-col overflow-hidden rounded-lg border border-hairline/40 bg-inset text-left outline-none transition-colors hover:border-accent/60 focus-visible:border-accent">
                  <img src={assetLink(asset)} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                  <span className="truncate px-2 py-1.5 text-[12px] text-ink-secondary group-hover:text-ink">{asset.name}</span>
                </button>
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
