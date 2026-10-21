import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canvasFontIds, canvasFontLoader } from "./canvas-fonts.ts";

const TTF = Buffer.concat([Buffer.from("00010000", "hex"), Buffer.alloc(60, 7)]);
const CSS = `
@font-face { font-family: 'Playfair Display'; font-style: normal; font-weight: 400; src: url(https://fonts.gstatic.com/s/playfair/v1/regular.ttf) format('truetype'); }
@font-face { font-family: 'Playfair Display'; font-style: normal; font-weight: 700; src: url(https://evil.example.com/s/playfair/bold.ttf) format('truetype'); }
`;

const dirs: string[] = [];
const cacheDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "canvas-fonts-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function google() {
  return vi.fn(async (url: string, _init?: RequestInit) => {
    if (url.startsWith("https://fonts.googleapis.com/css2?family=Playfair+Display")) return new Response(CSS);
    if (url === "https://fonts.gstatic.com/s/playfair/v1/regular.ttf") return new Response(TTF);
    return new Response("nope", { status: 404 });
  });
}

describe("canvasFontLoader", () => {
  it("downloads only the gstatic TrueType faces a brand font lists and caches them on disk", async () => {
    const fetch = google();
    const dir = cacheDir();
    const fonts = await canvasFontLoader({ cacheDir: dir, fetch })(["playfair-display", "georgia"]);
    expect(fonts).toEqual({ files: [join(dir, "playfair-display", "normal-400.ttf")], missing: [] });
    expect(readFileSync(fonts.files[0]!)).toEqual(TTF);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800;900",
      "https://fonts.gstatic.com/s/playfair/v1/regular.ttf",
    ]);
    expect(fetch.mock.calls[0]![1]?.headers).toEqual({ "User-Agent": "OpenMausBot canvas renderer" });
  });

  it("serves a cached font without the network, and shares one download between concurrent renders", async () => {
    const dir = cacheDir();
    const fetch = google();
    const first = canvasFontLoader({ cacheDir: dir, fetch });
    const [a, b] = await Promise.all([first(["playfair-display"]), first(["playfair-display"])]);
    expect(a).toEqual(b);
    expect(fetch).toHaveBeenCalledTimes(2);
    const offline = vi.fn(async () => { throw new Error("offline"); });
    expect(await canvasFontLoader({ cacheDir: dir, fetch: offline })(["playfair-display"])).toEqual(a);
    expect(offline).not.toHaveBeenCalled();
  });

  it("reports a font it cannot fetch as missing and waits before trying again", async () => {
    let now = 0;
    const offline = vi.fn(async () => { throw new Error("offline"); });
    const load = canvasFontLoader({ cacheDir: cacheDir(), fetch: offline, now: () => now });
    expect(await load(["fraunces", "inter"])).toEqual({ files: [], missing: ["Inter", "Fraunces"] });
    expect(await load(["fraunces"])).toEqual({ files: [], missing: ["Fraunces"] });
    expect(offline).toHaveBeenCalledTimes(2);
    now = 11 * 60_000;
    await load(["fraunces"]);
    expect(offline).toHaveBeenCalledTimes(3);
  });

  it("rejects a face that is not TrueType or OpenType", async () => {
    const fetch = vi.fn(async (url: string) => new Response(url.includes("googleapis") ? CSS : Buffer.from("wOF2 compressed font data")));
    expect(await canvasFontLoader({ cacheDir: cacheDir(), fetch })(["playfair-display"])).toEqual({ files: [], missing: ["Playfair Display"] });
  });
});

describe("canvasFontIds", () => {
  it("names the downloadable faces an SVG asks for first", () => {
    const svg = '<text font-family="&quot;Playfair Display&quot;, Georgia, serif">Interactive</text><text font-family="Inter, ui-sans-serif">x</text><text font-family="Georgia, serif">y</text>';
    expect(canvasFontIds(svg)).toEqual(["playfair-display", "inter"]);
  });
});
