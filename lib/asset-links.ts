/** Name and type the Add asset dialog derives from a link until the user edits them. */
export type LinkAssetType = "image" | "document" | "figma" | "font" | "apk" | "other";

function parseLink(value: string) {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch { return null; }
}

const hostOf = (url: URL) => url.hostname.replace(/^www\./, "");
const lastSegment = (url: URL) => {
  const segment = url.pathname.split("/").filter(Boolean).pop() || "";
  try { return decodeURIComponent(segment); } catch { return segment; }
};
const isFigma = (host: string) => /(^|\.)figma\.com$/.test(host);
const documentHosts = /(^|\.)(docs\.google\.com|drive\.google\.com|notion\.so|notion\.site|coda\.io|quip\.com|dropbox\.com|box\.com|onedrive\.live\.com|sharepoint\.com|atlassian\.net|gitbook\.io|craft\.do|dropboxpaper\.com)$/;

/** "Design System" for a Figma file link, "spec.pdf" for a file link, otherwise the host. Empty until it parses. */
export function linkAssetName(value: string) {
  const url = parseLink(value);
  if (!url || !url.hostname) return "";
  const host = hostOf(url);
  if (isFigma(host)) {
    const [, kind, , name] = url.pathname.split("/");
    if (kind && name && /^(file|design|proto|board|slides|deck|make)$/.test(kind)) {
      let title = name;
      try { title = decodeURIComponent(name); } catch { /* Keep the raw segment. */ }
      title = title.replace(/[-_]+/g, " ").trim();
      if (title) return title.slice(0, 150);
    }
    return host;
  }
  const file = lastSegment(url);
  return (/\.[a-z0-9]{2,5}$/i.test(file) ? file : host).slice(0, 150);
}

/** Figma links are Figma, image/font/APK files keep their kind, docs and file links are documents, the rest Other. */
export function linkAssetType(value: string): LinkAssetType {
  const url = parseLink(value);
  if (!url || !url.hostname) return "other";
  const host = hostOf(url);
  if (isFigma(host)) return "figma";
  const extension = lastSegment(url).match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || "";
  if (/^(png|jpe?g|gif|webp|svg|avif|heic)$/.test(extension)) return "image";
  if (/^(woff2?|ttf|otf)$/.test(extension) || host === "fonts.google.com") return "font";
  if (extension === "apk") return "apk";
  if (/^(pdf|docx?|pptx?|xlsx?|odt|ods|odp|rtf|txt|md|csv|key|pages|numbers)$/.test(extension)) return "document";
  if (documentHosts.test(host) || /^docs\./.test(host)) return "document";
  return "other";
}
