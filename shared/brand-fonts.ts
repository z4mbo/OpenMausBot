/** A typeface a brand kit may choose: a Google Font, or a web-safe stack that needs no download. */
export interface BrandFont {
  id: string;
  family: string;
  category: "sans" | "serif" | "display" | "mono";
  /** The generic stack that follows the family, so text keeps its shape while the face loads. */
  fallback: "sans" | "serif" | "mono";
  /** The `family=` value of a Google Fonts css2 request; null for a web-safe face. */
  google: string | null;
}

export const BRAND_FONTS = [
  { id: "inter", family: "Inter", category: "sans", fallback: "sans", google: "Inter:wght@300;400;500;600;700;800;900" },
  { id: "manrope", family: "Manrope", category: "sans", fallback: "sans", google: "Manrope:wght@300;400;500;600;700;800" },
  { id: "dm-sans", family: "DM Sans", category: "sans", fallback: "sans", google: "DM+Sans:wght@300;400;500;600;700;800;900" },
  { id: "plus-jakarta-sans", family: "Plus Jakarta Sans", category: "sans", fallback: "sans", google: "Plus+Jakarta+Sans:wght@300;400;500;600;700;800" },
  { id: "space-grotesk", family: "Space Grotesk", category: "sans", fallback: "sans", google: "Space+Grotesk:wght@300;400;500;600;700" },
  { id: "outfit", family: "Outfit", category: "sans", fallback: "sans", google: "Outfit:wght@300;400;500;600;700;800;900" },
  { id: "work-sans", family: "Work Sans", category: "sans", fallback: "sans", google: "Work+Sans:wght@300;400;500;600;700;800;900" },
  { id: "ibm-plex-sans", family: "IBM Plex Sans", category: "sans", fallback: "sans", google: "IBM+Plex+Sans:wght@300;400;500;600;700" },
  { id: "system", family: "System UI", category: "sans", fallback: "sans", google: null },
  { id: "playfair-display", family: "Playfair Display", category: "display", fallback: "serif", google: "Playfair+Display:wght@400;500;600;700;800;900" },
  { id: "fraunces", family: "Fraunces", category: "display", fallback: "serif", google: "Fraunces:wght@300;400;500;600;700;800;900" },
  { id: "dm-serif-display", family: "DM Serif Display", category: "display", fallback: "serif", google: "DM+Serif+Display" },
  { id: "instrument-serif", family: "Instrument Serif", category: "display", fallback: "serif", google: "Instrument+Serif" },
  { id: "lora", family: "Lora", category: "serif", fallback: "serif", google: "Lora:wght@400;500;600;700" },
  { id: "source-serif-4", family: "Source Serif 4", category: "serif", fallback: "serif", google: "Source+Serif+4:wght@300;400;500;600;700;800;900" },
  { id: "georgia", family: "Georgia", category: "serif", fallback: "serif", google: null },
  { id: "jetbrains-mono", family: "JetBrains Mono", category: "mono", fallback: "mono", google: "JetBrains+Mono:wght@300;400;500;600;700;800" },
  { id: "ibm-plex-mono", family: "IBM Plex Mono", category: "mono", fallback: "mono", google: "IBM+Plex+Mono:wght@300;400;500;600;700" },
] as const satisfies readonly BrandFont[];

export type BrandFontId = (typeof BRAND_FONTS)[number]["id"];

export const BRAND_FONT_IDS: readonly BrandFontId[] = BRAND_FONTS.map((font) => font.id);

export const isBrandFont = (value: unknown): value is BrandFontId => typeof value === "string" && (BRAND_FONT_IDS as readonly string[]).includes(value);

export function brandFont(id: string): BrandFont | undefined {
  return BRAND_FONTS.find((font) => font.id === id);
}

const SYSTEM_STACK = "system-ui, -apple-system, \"Segoe UI\", Roboto, sans-serif";

/** The CSS font-family of a brand face, ahead of the stack it falls back to. */
export function brandFontStack(id: string, fallbackStack: string): string {
  const font = brandFont(id);
  if (!font) return fallbackStack;
  if (font.id === "system") return SYSTEM_STACK;
  return `"${font.family}", ${fallbackStack}`;
}

/** The Google Fonts stylesheet for these faces, or null when none of them needs one. */
export function googleFontsHref(ids: readonly string[]): string | null {
  const families = [...new Set(ids)].map((id) => brandFont(id)?.google).filter((value): value is string => Boolean(value));
  return families.length ? `https://fonts.googleapis.com/css2?${families.map((family) => `family=${family}`).join("&")}&display=swap` : null;
}
