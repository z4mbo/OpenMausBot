import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, ImagePlus, Loader2, Plus, Sparkles, X } from "lucide-react";
import { cloudMutation, useCloudQuery } from "@/lib/origin-cloud";
import { setAvatarLook } from "@/lib/origin-avatar-looks";
import { handOff } from "@/lib/origin-handoff";
import { brandDraftBrief, useBrandKit } from "@/lib/origin-brand";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStore } from "@/state/store";
import { cn } from "@/lib/cn";
import { Select } from "../Select";
import type { CloudDesign, CloudDesignAsset } from "../origin-pages/cloud-types";
import { EmptyState, Field, Loading, Modal, Notice, cardClass, ghostButton, iconButton, inputClass, primaryButton, useAction } from "../origin-pages/ui";
import { BRAND_FONTS } from "../../../shared/brand-fonts";
import {
  BRAND_LIMITS, brandColor, brandContrastChecks, contrastPasses, defaultBrandKit, normalizeBrandKit,
  type BrandKit, type ContrastCheck, type StoredBrandKit,
} from "../../../shared/brand-kit";
import { BrandPreview } from "./BrandPreview";

const FONT_GROUPS = [["sans", "Sans"], ["display", "Display"], ["serif", "Serif"], ["mono", "Mono"]] as const;
const LEVEL_LABEL = { AAA: "AAA", AA: "AA", large: "Large text", fail: "Fails" } as const;

const isImage = (asset: CloudDesignAsset) => asset.type === "image" || asset.type === "icon" || Boolean(asset.contentType?.startsWith("image/"));
const assetLink = (asset: CloudDesignAsset | undefined) => asset ? asset.fileUrl || asset.url || null : null;

function kitOf(stored: StoredBrandKit): BrandKit {
  return {
    name: stored.name, tagline: stored.tagline, voice: stored.voice, colors: stored.colors, fonts: stored.fonts,
    logoAssetIds: stored.logoAssetIds, ...(stored.iconAssetId ? { iconAssetId: stored.iconAssetId } : {}), imagery: stored.imagery,
  };
}

export function BrandPanel({ projectId, projectName, canEdit, botId }: { projectId: string; projectName: string; canEdit: boolean; botId?: string }) {
  const stored = useBrandKit(projectId);
  const design = useCloudQuery<CloudDesign>("design:list", { projectId });
  if (stored === undefined || !design) return <Loading label="Loading the brand kit" variant="list" />;
  return <BrandEditor key={stored?._id ?? "new"} stored={stored} images={design.assets.filter(isImage)} projectId={projectId} projectName={projectName} canEdit={canEdit} botId={botId} />;
}

function BrandEditor({ stored, images, projectId, projectName, canEdit, botId }: {
  stored: StoredBrandKit | null; images: CloudDesignAsset[]; projectId: string; projectName: string; canEdit: boolean; botId?: string;
}) {
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const chief = botId ? state.bots.find((bot) => bot.id === botId) : undefined;
  const remote = useMemo(() => (stored ? kitOf(stored) : defaultBrandKit(projectName)), [stored, projectName]);
  const [kit, setKit] = useState<BrandKit>(remote);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [picking, setPicking] = useState<"logo" | "icon" | null>(null);
  const action = useAction();
  const remoteKey = JSON.stringify(remote);
  useEffect(() => { if (!dirty) setKit(remote); }, [remoteKey, dirty]);

  const change = (next: BrandKit) => { setKit(next); setDirty(true); setSaved(false); };
  const problems = normalizeBrandKit(kit, defaultBrandKit(projectName)).problems;
  const checks = brandContrastChecks(kit);
  const byId = new Map(images.map((asset) => [asset._id, asset]));
  const logo = kit.logoAssetIds.map((id) => byId.get(id)).find(Boolean);
  const icon = kit.iconAssetId ? byId.get(kit.iconAssetId) : undefined;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canEdit || problems.length) return;
    const ok = await action.run(() => cloudMutation("brand:update", {
      projectId,
      kit: { name: kit.name, tagline: kit.tagline, voice: kit.voice, colors: kit.colors, fonts: kit.fonts, logoAssetIds: kit.logoAssetIds, iconAssetId: kit.iconAssetId ?? "", imagery: kit.imagery },
    }), "Could not save the brand kit");
    if (ok) { setDirty(false); setSaved(true); }
  };

  const status = dirty ? "Unsaved changes" : stored ? `Saved by ${stored.agentName ?? stored.updatedBy} · ${new Date(stored.updatedAt).toLocaleDateString()}` : "Not saved yet";

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:items-start" data-brand-panel>
      <form onSubmit={save} className={cn(cardClass, "flex min-w-0 flex-col")} aria-label="Brand kit">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline/30 px-4 py-3">
          <span className={cn("min-w-0 flex-1 truncate text-[12.5px] max-sm:basis-full", dirty ? "text-ink-secondary" : "text-ink-tertiary")} role="status">{status}</span>
          {canEdit && chief && (
            <button type="button" className={ghostButton} onClick={() => handOff(dispatch, chief, brandDraftBrief(projectName), showThreads)}>
              <Sparkles size={14} />Draft with {chief.name}
            </button>
          )}
          {canEdit && (
            <button className={primaryButton} disabled={action.busy || !dirty || problems.length > 0}>
              {action.busy ? <Loader2 size={14} className="animate-spin" /> : saved ? <Check size={14} /> : null}{saved && !dirty ? "Saved" : "Save brand"}
            </button>
          )}
        </div>
        {action.error && <div className="px-4 pt-3"><Notice tone="danger">{action.error}</Notice></div>}
        {!canEdit && <div className="px-4 pt-3"><Notice>Only editors can change the brand kit.</Notice></div>}
        <fieldset disabled={!canEdit || action.busy} className="flex min-w-0 flex-col divide-y divide-hairline/30">
          <Group title="Identity">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input className={inputClass} value={kit.name} maxLength={BRAND_LIMITS.name} onChange={(event) => change({ ...kit, name: event.target.value })} /></Field>
              <Field label="Tagline"><input className={inputClass} value={kit.tagline} maxLength={BRAND_LIMITS.tagline} onChange={(event) => change({ ...kit, tagline: event.target.value })} /></Field>
            </div>
          </Group>
          <Group title="Colours" action={botId && canEdit ? <AccentButton botId={botId} color={kit.colors.primary} /> : null}>
            <div className="grid gap-3 sm:grid-cols-2">
              <ColorInput label="Primary" value={kit.colors.primary} onChange={(primary) => change({ ...kit, colors: { ...kit.colors, primary } })} />
              <ColorInput label="Secondary" value={kit.colors.secondary} onChange={(secondary) => change({ ...kit, colors: { ...kit.colors, secondary } })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-ink-secondary">Neutrals</span>
              <div className="grid gap-2 sm:grid-cols-2">
                {kit.colors.neutrals.map((color, at) => (
                  <ColorInput key={at} label={`Neutral ${at + 1}`} hideLabel value={color}
                    onChange={(next) => change({ ...kit, colors: { ...kit.colors, neutrals: kit.colors.neutrals.map((item, index) => (index === at ? next : item)) } })}
                    onRemove={kit.colors.neutrals.length > 1 ? () => change({ ...kit, colors: { ...kit.colors, neutrals: kit.colors.neutrals.filter((_, index) => index !== at) } }) : undefined} />
                ))}
                {kit.colors.neutrals.length < BRAND_LIMITS.neutrals && (
                  <button type="button" className={cn(ghostButton, "justify-start")} onClick={() => change({ ...kit, colors: { ...kit.colors, neutrals: [...kit.colors.neutrals, "#E5E7EB"] } })}>
                    <Plus size={14} />Add neutral
                  </button>
                )}
              </div>
            </div>
            <ContrastList checks={checks} />
          </Group>
          <Group title="Type">
            <div className="grid gap-3 sm:grid-cols-2">
              <FontSelect label="Headings" value={kit.fonts.heading} onChange={(heading) => change({ ...kit, fonts: { ...kit.fonts, heading } })} />
              <FontSelect label="Body" value={kit.fonts.body} onChange={(body) => change({ ...kit, fonts: { ...kit.fonts, body } })} />
            </div>
          </Group>
          <Group title="Voice">
            <TagInput label="Sounds" placeholder="warm, precise" values={kit.voice.adjectives} max={BRAND_LIMITS.adjectives}
              onChange={(adjectives) => change({ ...kit, voice: { ...kit.voice, adjectives } })} />
            <div className="grid gap-3 sm:grid-cols-2">
              <LinesInput label="Do" values={kit.voice.do} onChange={(lines) => change({ ...kit, voice: { ...kit.voice, do: lines } })} />
              <LinesInput label="Don't" values={kit.voice.dont} onChange={(lines) => change({ ...kit, voice: { ...kit.voice, dont: lines } })} />
            </div>
          </Group>
          <Group title="Logo and icon">
            <div className="flex flex-wrap gap-2">
              {kit.logoAssetIds.map((id) => (
                <AssetTile key={id} label="Logo" asset={byId.get(id)} onRemove={() => change({ ...kit, logoAssetIds: kit.logoAssetIds.filter((item) => item !== id) })} />
              ))}
              {kit.logoAssetIds.length < BRAND_LIMITS.logos && <AddTile label="Add logo" onClick={() => setPicking("logo")} />}
              {icon || kit.iconAssetId
                ? <AssetTile label="Icon" asset={icon} onRemove={() => { const { iconAssetId: _gone, ...rest } = kit; change(rest); }} />
                : <AddTile label="Add icon" onClick={() => setPicking("icon")} />}
            </div>
          </Group>
          <Group title="Imagery">
            <TagInput label="Style words for images" placeholder="soft daylight, film grain" values={kit.imagery} max={BRAND_LIMITS.imagery}
              onChange={(imagery) => change({ ...kit, imagery })} />
          </Group>
        </fieldset>
        {problems.length > 0 && dirty && <div className="px-4 pb-4"><Notice tone="danger">{problems[0]}</Notice></div>}
      </form>
      <aside className="order-first min-w-0 lg:sticky lg:top-3 lg:order-none" aria-label="Brand preview">
        <BrandPreview kit={kit} logoUrl={assetLink(logo)} iconUrl={assetLink(icon)} />
      </aside>
      {picking && (
        <AssetPicker images={images.filter((asset) => !kit.logoAssetIds.includes(asset._id) && asset._id !== kit.iconAssetId)} title={picking === "logo" ? "Choose a logo" : "Choose an icon"}
          onClose={() => setPicking(null)}
          onPick={(asset) => {
            change(picking === "logo" ? { ...kit, logoAssetIds: [...kit.logoAssetIds, asset._id] } : { ...kit, iconAssetId: asset._id });
            setPicking(null);
          }} />
      )}
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 px-4 py-4">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold text-ink">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function AccentButton({ botId, color }: { botId: string; color: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  useEffect(() => { setState("idle"); }, [color]);
  return (
    <button type="button" className="inline-flex h-7 items-center gap-1.5 rounded-full px-2 text-[12px] text-ink-secondary outline-none transition-colors hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50"
      disabled={state === "busy" || !brandColor(color)} title="Make the primary colour this project's accent across the app"
      onClick={() => { setState("busy"); void setAvatarLook(botId, { color }).then(() => setState("done"), () => setState("idle")); }}>
      {state === "done" ? <Check size={12} className="text-success" /> : <span className="size-3 rounded-full" style={{ background: brandColor(color) ?? "transparent" }} aria-hidden="true" />}
      {state === "done" ? "Accent follows primary" : "Use as accent"}
    </button>
  );
}

function ColorInput({ label, value, onChange, onRemove, hideLabel }: { label: string; value: string; onChange(value: string): void; onRemove?: () => void; hideLabel?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const valid = brandColor(shown);
  const control = (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="relative size-8 shrink-0 overflow-hidden rounded-lg border border-hairline/60" style={{ background: valid ?? value }}>
        <input type="color" aria-label={`${label} colour picker`} value={brandColor(value) ?? "#000000"} onChange={(event) => { setDraft(null); onChange(event.target.value.toUpperCase()); }}
          className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default" />
      </span>
      <input className={cn(inputClass, "font-mono uppercase", !valid && "border-danger/60 focus:border-danger")} aria-label={`${label} hex`} aria-invalid={!valid} value={shown} maxLength={7} spellCheck={false}
        onChange={(event) => { setDraft(event.target.value); const next = brandColor(event.target.value); if (next) onChange(next); }}
        onBlur={() => setDraft(null)} />
      {onRemove && <button type="button" className={iconButton} aria-label={`Remove ${label.toLowerCase()}`} onClick={onRemove}><X size={14} /></button>}
    </div>
  );
  return hideLabel ? control : <div className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-secondary"><span>{label}</span>{control}</div>;
}

function ContrastList({ checks }: { checks: ContrastCheck[] }) {
  return (
    <ul className="grid gap-1.5 sm:grid-cols-2" aria-label="Contrast checks">
      {checks.map((check) => {
        const passes = contrastPasses(check);
        return (
          <li key={check.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-inset/60 px-2.5 py-1.5 text-[12px]">
            <span className="flex h-6 w-8 shrink-0 items-center justify-center rounded-md text-[12px] font-semibold" style={{ background: check.background, color: check.foreground }} aria-hidden="true">Aa</span>
            <span className="min-w-0 flex-1 truncate text-ink-secondary">{check.label}</span>
            <span className="shrink-0 tabular-nums text-ink-tertiary">{check.ratio.toFixed(1)}:1</span>
            <span className={cn("shrink-0 font-medium", passes ? (check.level === "large" ? "text-warning" : "text-success") : "text-danger")}>{passes ? LEVEL_LABEL[check.level] : "Fails"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function FontSelect({ label, value, onChange }: { label: string; value: string; onChange(value: BrandKit["fonts"]["heading"]): void }) {
  return (
    <Field label={label}>
      <Select className="w-full" value={value} onChange={(event) => onChange(event.target.value as BrandKit["fonts"]["heading"])}>
        {FONT_GROUPS.map(([category, title]) => (
          <optgroup key={category} label={title}>
            {BRAND_FONTS.filter((font) => font.category === category).map((font) => <option key={font.id} value={font.id}>{font.family}</option>)}
          </optgroup>
        ))}
      </Select>
    </Field>
  );
}

function TagInput({ label, placeholder, values, max, onChange }: { label: string; placeholder: string; values: string[]; max: number; onChange(values: string[]): void }) {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (raw: string) => {
    const words = raw.split(",").map((word) => word.trim()).filter(Boolean);
    const next = [...values];
    for (const word of words) if (next.length < max && !next.some((item) => item.toLowerCase() === word.toLowerCase())) next.push(word.slice(0, 40));
    if (next.length !== values.length) onChange(next);
    setText("");
  };
  const onKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && text.trim()) { event.preventDefault(); add(text); }
    else if (event.key === "Enter") event.preventDefault();
    else if (event.key === "Backspace" && !text && values.length) onChange(values.slice(0, -1));
  };
  return (
    <div className="flex min-w-0 flex-col gap-1 text-[12px] font-medium text-ink-secondary">
      <span>{label}</span>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-hairline/60 bg-inset px-1.5 py-1 transition-colors focus-within:border-accent/70 hover:border-hairline" onClick={() => input.current?.focus()}>
        {values.map((value) => (
          <span key={value} className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-raised pl-2 pr-0.5 text-[12px] font-normal text-ink">
            <span className="truncate">{value}</span>
            <button type="button" aria-label={`Remove ${value}`} onClick={() => onChange(values.filter((item) => item !== value))}
              className="flex size-5 items-center justify-center rounded text-ink-tertiary outline-none hover:bg-raised-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><X size={11} /></button>
          </span>
        ))}
        {values.length < max && (
          <input ref={input} aria-label={label} value={text} placeholder={values.length ? "" : placeholder} onChange={(event) => setText(event.target.value)} onKeyDown={onKey} onBlur={() => text.trim() && add(text)}
            className="h-6 min-w-[96px] flex-1 bg-transparent px-1 text-[13px] font-normal text-ink outline-none placeholder:text-ink-tertiary max-md:text-[16px]" />
        )}
      </div>
    </div>
  );
}

function LinesInput({ label, values, onChange }: { label: string; values: string[]; onChange(values: string[]): void }) {
  const [text, setText] = useState(values.join("\n"));
  const joined = values.join("\n");
  const typed = text.split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
  useEffect(() => { if (joined !== typed) setText(joined); }, [joined]);
  return (
    <Field label={label}>
      <textarea className={cn(inputClass, "resize-y")} rows={3} value={text} placeholder="One per line"
        onChange={(event) => { setText(event.target.value); onChange(event.target.value.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, BRAND_LIMITS.rules)); }} />
    </Field>
  );
}

function AssetTile({ label, asset, onRemove }: { label: string; asset: CloudDesignAsset | undefined; onRemove(): void }) {
  const url = assetLink(asset);
  return (
    <div className="relative flex w-24 flex-col overflow-hidden rounded-lg border border-hairline/40 bg-inset">
      <span className="flex h-16 items-center justify-center p-2">{url ? <img src={url} alt={asset?.name ?? label} className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] text-ink-tertiary">Missing</span>}</span>
      <span className="truncate border-t border-hairline/30 px-2 py-1 text-[11px] text-ink-secondary" title={asset?.name}>{label}</span>
      <button type="button" aria-label={`Remove ${label.toLowerCase()} ${asset?.name ?? ""}`.trim()} onClick={onRemove}
        className="absolute right-1 top-1 flex size-6 items-center justify-center rounded-md bg-panel/90 text-ink-secondary outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><X size={12} /></button>
    </div>
  );
}

function AddTile({ label, onClick }: { label: string; onClick(): void }) {
  return (
    <button type="button" onClick={onClick}
      className="flex h-[89px] w-24 flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-hairline text-[11.5px] text-ink-secondary outline-none transition-colors hover:border-accent/60 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-50">
      <ImagePlus size={16} />{label}
    </button>
  );
}

function AssetPicker({ images, title, onPick, onClose }: { images: CloudDesignAsset[]; title: string; onPick(asset: CloudDesignAsset): void; onClose(): void }) {
  return (
    <Modal title={title} onClose={onClose} wide>
      {!images.length ? <EmptyState compact icon={<ImagePlus size={22} />} title="No images in Assets yet" body="Upload the logo in Files first." /> : (
        <div className="grid max-h-[60vh] grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 overflow-y-auto">
          {images.map((asset) => (
            <button key={asset._id} type="button" onClick={() => onPick(asset)}
              className="group flex flex-col overflow-hidden rounded-lg border border-hairline/40 bg-inset text-left outline-none transition-colors hover:border-accent/60 focus-visible:border-accent">
              <span className="flex aspect-square w-full items-center justify-center p-3"><img src={assetLink(asset) ?? ""} alt="" loading="lazy" className="max-h-full max-w-full object-contain" /></span>
              <span className="truncate px-2 py-1.5 text-[12px] text-ink-secondary group-hover:text-ink">{asset.name}</span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
