import { mkdirSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { BRAND_FONTS, type BrandFontId } from "../shared/brand-fonts.ts";
import { writeFileAtomic } from "./atomic.ts";

/** The local font files a canvas render can use, and the brand families that could not be fetched. */
export interface CanvasFontFiles {
  files: string[];
  missing: string[];
}

export type CanvasFontLoader = (ids: readonly string[]) => Promise<CanvasFontFiles>;

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const CSS_ENDPOINT = "https://fonts.googleapis.com/css2";
/** Google Fonts answers a client without a modern browser User-Agent with TrueType URLs instead of woff2, which resvg 2.6 cannot read. */
const PLAIN_USER_AGENT = "OpenMausBot canvas renderer";
/** Security invariant: font bytes are fetched from this host only, whatever URLs the stylesheet lists. */
const FONT_HOST = "fonts.gstatic.com";
const CSS_TIMEOUT_MS = 8_000;
const FACE_TIMEOUT_MS = 15_000;
const FACE_MAX_BYTES = 5 * 1024 * 1024;
const FAMILY_MAX_BYTES = 12 * 1024 * 1024;
const FAMILY_MAX_FACES = 16;
const RETRY_AFTER_MS = 10 * 60_000;

interface Manifest {
  spec: string;
  files: string[];
}

interface Face {
  url: string;
  name: string;
}

const firstFamily = /font-family="(?:&quot;)?([^&",]+)/g;

/** The downloadable brand faces an SVG from `sceneSvg` names first in a font-family, which is the face resvg would try. */
export function canvasFontIds(svg: string): BrandFontId[] {
  const ids = new Set<BrandFontId>();
  for (const match of svg.matchAll(firstFamily)) {
    const font = BRAND_FONTS.find((candidate) => candidate.family === match[1]!.trim());
    if (font?.google) ids.add(font.id);
  }
  return [...ids];
}

function fontUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim().replace(/^['"]|['"]$/g, ""));
    return url.protocol === "https:" && url.hostname === FONT_HOST && !url.username && !url.password && !url.port ? url.href : null;
  } catch {
    return null;
  }
}

function facesOf(css: string): Face[] {
  const faces: Face[] = [];
  const names = new Set<string>();
  for (const block of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = block[1]!;
    const url = fontUrl(/src:[^;]*?url\(([^)]+)\)/.exec(body)?.[1] ?? "");
    if (!url || !/\.(ttf|otf)$/i.test(new URL(url).pathname)) continue;
    const style = /font-style:\s*(normal|italic)/.exec(body)?.[1] ?? "normal";
    const weight = /font-weight:\s*(\d{3})/.exec(body)?.[1] ?? "400";
    const name = `${style}-${weight}${names.has(`${style}-${weight}`) ? `-${faces.length}` : ""}.ttf`;
    names.add(`${style}-${weight}`);
    faces.push({ url, name });
  }
  return faces.slice(0, FAMILY_MAX_FACES);
}

const isSfnt = (bytes: Buffer) => bytes.length > 12 && ["00010000", "74727565", "4f54544f"].includes(bytes.subarray(0, 4).toString("hex"));

async function download(fetchImpl: Fetch, face: Face): Promise<Buffer> {
  const response = await fetchImpl(face.url, { redirect: "error", signal: AbortSignal.timeout(FACE_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`font ${response.status}`);
  if (Number(response.headers.get("content-length") ?? 0) > FACE_MAX_BYTES) throw new Error("font too large");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > FACE_MAX_BYTES || !isSfnt(bytes)) throw new Error("not a TrueType or OpenType font");
  return bytes;
}

/** Fetches brand fonts from Google Fonts into `cacheDir` once, then serves them from disk; anything unreachable is reported missing, never thrown. */
export function canvasFontLoader(options: { cacheDir: string; fetch?: Fetch; now?: () => number }): CanvasFontLoader {
  const fetchImpl: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? Date.now;
  const inflight = new Map<BrandFontId, Promise<string[] | null>>();
  const failedAt = new Map<BrandFontId, number>();

  const familyDir = (id: BrandFontId) => join(options.cacheDir, id);
  const manifestPath = (id: BrandFontId) => join(options.cacheDir, `${id}.json`);

  async function cached(id: BrandFontId, spec: string): Promise<string[] | null> {
    try {
      const manifest = JSON.parse(await readFile(manifestPath(id), "utf8")) as Manifest;
      if (manifest.spec !== spec || !Array.isArray(manifest.files) || !manifest.files.length) return null;
      const paths = manifest.files.map((file) => join(familyDir(id), String(file).replace(/[^\w.-]/g, "")));
      await Promise.all(paths.map((path) => access(path)));
      return paths;
    } catch {
      return null;
    }
  }

  async function fetchFamily(id: BrandFontId, spec: string): Promise<string[] | null> {
    try {
      const response = await fetchImpl(`${CSS_ENDPOINT}?family=${spec}`, { headers: { "User-Agent": PLAIN_USER_AGENT }, signal: AbortSignal.timeout(CSS_TIMEOUT_MS) });
      if (!response.ok) return null;
      const faces = facesOf(await response.text());
      if (!faces.length) return null;
      const fonts = await Promise.all(faces.map((face) => download(fetchImpl, face)));
      if (fonts.reduce((total, bytes) => total + bytes.length, 0) > FAMILY_MAX_BYTES) return null;
      mkdirSync(familyDir(id), { recursive: true });
      faces.forEach((face, at) => writeFileAtomic(join(familyDir(id), face.name), fonts[at]!, { durable: false }));
      writeFileAtomic(manifestPath(id), JSON.stringify({ spec, files: faces.map((face) => face.name) } satisfies Manifest), { durable: false });
      return faces.map((face) => join(familyDir(id), face.name));
    } catch {
      return null;
    }
  }

  function family(id: BrandFontId, spec: string): Promise<string[] | null> {
    const running = inflight.get(id);
    if (running) return running;
    const task = (async () => {
      const hit = await cached(id, spec);
      if (hit) return hit;
      const lastFailure = failedAt.get(id);
      if (lastFailure !== undefined && now() - lastFailure < RETRY_AFTER_MS) return null;
      const fetched = await fetchFamily(id, spec);
      if (fetched) failedAt.delete(id);
      else failedAt.set(id, now());
      return fetched;
    })().finally(() => inflight.delete(id));
    inflight.set(id, task);
    return task;
  }

  return async (ids) => {
    const wanted = new Set(ids);
    const fonts = BRAND_FONTS.filter((font) => font.google !== null && wanted.has(font.id));
    const results = await Promise.all(fonts.map((font) => family(font.id, font.google!)));
    return {
      files: results.flatMap((paths) => paths ?? []),
      missing: fonts.filter((_, at) => !results[at]).map((font) => font.family),
    };
  };
}
