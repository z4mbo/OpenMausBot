export { APP_NAME } from "../../shared/product-brand.mjs";
/** The URL scheme the desktop app registers; chat links it opens start with it. */
export const APP_SCHEME = "origin-app";
const UPSTREAM_REPOSITORY = "https://github.com/milind-soni/OpenMausBot";
export const APP_REPOSITORY = "https://github.com/z4mbo/Origin";
export const DOCS_URL = `${APP_REPOSITORY}/tree/origin-integration/docs`;
export const HELP_CENTER_URL = DOCS_URL;
export const APPROVAL_LEVELS_URL = `${APP_REPOSITORY}/blob/origin-integration/docs/approval-levels.md`;
export const FEEDBACK_URL = `${APP_REPOSITORY}/issues/new/choose`;
export const RELEASES_URL = "https://origin.imbored.fun/downloads/";
export const PRICING_URL = "https://www.openmausbot.com/pricing";
export function withSource(url: string, source: string): string {
  const target = new URL(url);
  target.searchParams.set("src", source);
  return target.href;
}
export const LICENSE_URL = `${APP_REPOSITORY}/blob/origin-integration/LICENSE`;
export const IOS_APP_STORE_URL = "https://apps.apple.com/in/app/mausbot/id6803387923";
export const ANDROID_APK_URL = `${UPSTREAM_REPOSITORY}/releases/download/android-v1.5.0/OpenMausBot.apk`;

export function appVersion(): string {
  return typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "dev";
}

const PLATFORM_NAMES: Record<string, string> = {
  darwin: "macOS",
  win32: "Windows",
  linux: "Linux",
};

export function platformLabel(platform?: string): string | null {
  return (platform && PLATFORM_NAMES[platform]) ?? null;
}

export async function openExternalLink(url: string): Promise<void> {
  if (window.ogb?.openExternal) {
    await window.ogb.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
