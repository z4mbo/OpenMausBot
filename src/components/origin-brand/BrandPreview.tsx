import { Check, Copy } from "lucide-react";
import { useCopyFeedback } from "@/lib/copy-text";
import { useBrandFonts } from "@/lib/origin-brand";
import { cn } from "@/lib/cn";
import { brandFont, brandFontStack } from "../../../shared/brand-fonts";
import { brandPalette, type BrandKit } from "../../../shared/brand-kit";

const SANS = "Inter, ui-sans-serif, system-ui, sans-serif";

function Swatch({ label, color }: { label: string; color: string }) {
  const { state, copy } = useCopyFeedback(color);
  return (
    <button type="button" onClick={copy} title={`Copy ${color}`} aria-label={`Copy ${label} ${color}`}
      className="group flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-hairline/40 text-left outline-none transition-colors hover:border-hairline focus-visible:ring-2 focus-visible:ring-accent/60">
      <span className="h-10 w-full" style={{ background: color }} />
      <span className="flex items-center gap-1 px-2 py-1.5">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11px] text-ink-tertiary">{label}</span>
          <span className="block truncate font-mono text-[11px] uppercase text-ink-secondary">{color}</span>
        </span>
        <span className={cn("shrink-0 text-ink-tertiary transition-opacity duration-(--motion-fast)", state === "idle" ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 touch:opacity-100" : "opacity-100")} aria-hidden="true">
          {state === "copied" ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </span>
      </span>
    </button>
  );
}

/** The kit drawn as a small page in its own colours and faces, beside the swatches. */
export function BrandPreview({ kit, logoUrl, iconUrl }: { kit: BrandKit; logoUrl?: string | null; iconUrl?: string | null }) {
  useBrandFonts([kit.fonts.heading, kit.fonts.body]);
  const palette = brandPalette(kit);
  const heading = brandFontStack(kit.fonts.heading, SANS);
  const body = brandFontStack(kit.fonts.body, SANS);
  const title = kit.tagline || kit.name || "Untitled brand";
  const voice = kit.voice.adjectives.length ? `${kit.name || "This brand"} sounds ${kit.voice.adjectives.join(", ")}.` : "";
  return (
    <div className="flex min-w-0 flex-col gap-3" data-brand-preview>
      <div className="overflow-hidden rounded-xl border border-hairline/40" style={{ background: palette.background, color: palette.text }}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: `1px solid ${palette.text}1A` }}>
          {logoUrl ? <img src={logoUrl} alt="" className="h-6 max-w-[120px] object-contain" />
            : iconUrl ? <img src={iconUrl} alt="" className="size-6 rounded object-cover" />
              : <span className="size-5 rounded-md" style={{ background: palette.primary }} aria-hidden="true" />}
          {!logoUrl && <span className="min-w-0 truncate text-[14px] font-semibold" style={{ fontFamily: heading }}>{kit.name || "Untitled brand"}</span>}
        </div>
        <div className="flex flex-col gap-3 px-4 pb-5 pt-4">
          <p className="m-0 break-words text-[24px] font-bold leading-[1.15] tracking-[-0.01em]" style={{ fontFamily: heading }}>{title}</p>
          {voice && <p className="m-0 text-[14px] leading-relaxed opacity-80" style={{ fontFamily: body }}>{voice}</p>}
          <div className="flex flex-wrap gap-2 pt-1" style={{ fontFamily: body }}>
            <span className="rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: palette.primary, color: palette.onPrimary }}>Primary</span>
            <span className="rounded-lg px-3 py-1.5 text-[13px] font-semibold" style={{ background: palette.secondary, color: palette.onSecondary }}>Secondary</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Swatch label="Primary" color={palette.primary} />
        <Swatch label="Secondary" color={palette.secondary} />
        {palette.neutrals.map((color, at) => <Swatch key={`${color}-${at}`} label={color === palette.background ? "Background" : color === palette.text ? "Text" : "Neutral"} color={color} />)}
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        <div className="min-w-0 rounded-lg bg-inset/60 px-3 py-2">
          <dt className="text-ink-tertiary">Headings</dt>
          <dd className="truncate text-[15px] text-ink" style={{ fontFamily: heading }}>{brandFont(kit.fonts.heading)?.family}</dd>
        </div>
        <div className="min-w-0 rounded-lg bg-inset/60 px-3 py-2">
          <dt className="text-ink-tertiary">Body</dt>
          <dd className="truncate text-[15px] text-ink" style={{ fontFamily: body }}>{brandFont(kit.fonts.body)?.family}</dd>
        </div>
      </dl>
    </div>
  );
}
