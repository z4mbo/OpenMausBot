import { brandContrastChecks, brandKitText, contrastPasses, type StoredBrandKit } from "../shared/brand-kit.ts";
import type { OriginCloudClient, OriginToolResult } from "./origin-cloud.ts";

type Args = Record<string, unknown>;

/** The project an agent's brand tool works in, resolved by the Origin tools' own project picking. */
export interface BrandToolScope {
  client: OriginCloudClient;
  sessionToken: string;
  projectId: string;
  projectName: string;
  caller: { id: string; name: string };
}

type BrandTool<C> = (args: Args, ctx: C) => Promise<OriginToolResult>;

const record = (value: unknown): Args => (value && typeof value === "object" && !Array.isArray(value) ? value as Args : {});
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const strings = (value: unknown): string[] | undefined => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined);

class BrandRefusal extends Error {}

async function readKit(scope: BrandToolScope): Promise<StoredBrandKit | null> {
  const kit = await scope.client.query("brand:get", { sessionToken: scope.sessionToken, projectId: scope.projectId });
  return kit && typeof kit === "object" ? kit as StoredBrandKit : null;
}

/** Asset names or ids to the project's asset ids, refusing any it does not have. */
async function assetIds(scope: BrandToolScope, wanted: readonly string[]): Promise<string[]> {
  if (!wanted.length) return [];
  const assets = (record(await scope.client.query("design:list", { sessionToken: scope.sessionToken, projectId: scope.projectId })).assets as Args[] | undefined) ?? [];
  return wanted.map((name) => {
    const key = name.trim().toLowerCase();
    const found = assets.find((asset) => asset._id === name.trim()) ?? assets.find((asset) => text(asset.name).toLowerCase() === key);
    if (!found) throw new BrandRefusal(`No asset "${name.slice(0, 80)}" in ${scope.projectName}; list them with origin_list_assets.`);
    return String(found._id);
  });
}

function kitPatch(args: Args, logos: string[] | undefined, icon: string | undefined): Args {
  const defined = (value: Args) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined));
  const voice = defined({ adjectives: strings(args.voice_adjectives), do: strings(args.voice_do), dont: strings(args.voice_dont) });
  const colors = defined({ primary: typeof args.primary === "string" ? args.primary : undefined, secondary: typeof args.secondary === "string" ? args.secondary : undefined, neutrals: strings(args.neutrals) });
  const fonts = defined({ heading: typeof args.heading_font === "string" ? args.heading_font : undefined, body: typeof args.body_font === "string" ? args.body_font : undefined });
  return defined({
    name: typeof args.name === "string" ? args.name : undefined,
    tagline: typeof args.tagline === "string" ? args.tagline : undefined,
    ...(Object.keys(voice).length ? { voice } : {}), ...(Object.keys(colors).length ? { colors } : {}), ...(Object.keys(fonts).length ? { fonts } : {}),
    logoAssetIds: logos, iconAssetId: icon, imagery: strings(args.imagery),
  });
}

/** origin_brand_get and origin_brand_update; `scope` picks the project as the other Origin tools do. */
export function brandTools<C>(scope: (args: Args, ctx: C) => Promise<BrandToolScope>): Record<"origin_brand_get" | "origin_brand_update", BrandTool<C>> {
  return {
    async origin_brand_get(args, ctx) {
      const target = await scope(args, ctx);
      const kit = await readKit(target);
      if (!kit) return { text: `${target.projectName} has no brand kit yet. Draft one from the project's description with origin_brand_update.` };
      return { text: brandKitText(kit, target.projectName) };
    },

    async origin_brand_update(args, ctx) {
      const target = await scope(args, ctx);
      try {
        const logos = strings(args.logos) ? await assetIds(target, strings(args.logos)!) : undefined;
        const icon = typeof args.icon === "string" ? (text(args.icon) ? (await assetIds(target, [args.icon]))[0] : "") : undefined;
        const kit = kitPatch(args, logos, icon);
        if (!Object.keys(kit).length) return { text: "Pass at least one field of the brand kit to change.", isError: true };
        await target.client.mutation("brand:update", { sessionToken: target.sessionToken, projectId: target.projectId, kit, agentName: target.caller.name });
      } catch (error) {
        const message = error instanceof Error ? (/Uncaught Error: ([^\n]+)/.exec(error.message)?.[1] ?? error.message) : String(error);
        return { text: message.replaceAll(target.sessionToken, "[redacted]"), isError: true };
      }
      const saved = (await readKit(target))!;
      const weak = brandContrastChecks(saved).filter((check) => !contrastPasses(check));
      const advice = weak.length ? `\nFix the contrast of: ${weak.map((check) => `${check.label} (${check.ratio}:1)`).join(", ")}.` : "";
      return { text: `Saved ${target.projectName}'s brand kit; the team sees it in Assets > Brand.${advice}\n\n${brandKitText(saved, target.projectName)}` };
    },
  };
}
