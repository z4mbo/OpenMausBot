import { useEffect, useState } from "react";
import { useCloudQuery } from "@/lib/origin-cloud";
import { brandFont, googleFontsHref } from "../../shared/brand-fonts";
import type { StoredBrandKit } from "../../shared/brand-kit";

export function useBrandKit(projectId: string | null | undefined): StoredBrandKit | null | undefined {
  return useCloudQuery<StoredBrandKit | null>("brand:get", projectId ? { projectId } : "skip");
}

const loading = new Map<string, Promise<void>>();

/** Adds the faces' Google Fonts stylesheet once and resolves when the browser has them, or gave up on them. */
export function loadBrandFonts(ids: readonly string[]): Promise<void> {
  const href = googleFontsHref(ids);
  if (!href || typeof document === "undefined") return Promise.resolve();
  let pending = loading.get(href);
  if (!pending) {
    pending = new Promise<void>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    }).then(() => Promise.all(ids.flatMap((id) => {
      const family = brandFont(id)?.family;
      return family && document.fonts ? [400, 700].map((weight) => document.fonts.load(`${weight} 16px "${family}"`)) : [];
    }))).then(() => undefined, () => undefined);
    loading.set(href, pending);
  }
  return pending;
}

/** Loads the faces and reports the set that finished loading, so measured text can be measured again. */
export function useBrandFonts(ids: readonly string[]): string {
  const key = [...new Set(ids)].sort().join(",");
  const [ready, setReady] = useState("");
  useEffect(() => {
    if (!key) return;
    let live = true;
    void loadBrandFonts(key.split(",")).then(() => { if (live) setReady(key); });
    return () => { live = false; };
  }, [key]);
  return ready;
}

export function brandDraftBrief(projectName: string): string {
  return `Draft the brand kit for ${projectName} with origin_brand_update. Work from the project's description and brief: a name and tagline, 3 to 5 voice adjectives with do and don't lines, primary, secondary and neutral colours whose contrast passes, a heading and a body font, the logo and icon from its Assets if it has them, and imagery style words. Then tell me what you chose and why.`;
}
