import { useEffect, useState } from "react";

const MAX_EDGE = 640;
const SETTLE_MS = 15_000;
const PARALLEL = 2;
const CACHE_NAME = "origin-video-posters-v1";
const CACHE_HOST = "https://video-poster.invalid/";

const ready = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();
const waiting: Array<() => void> = [];
let active = 0;

async function slot<T>(task: () => Promise<T>): Promise<T> {
  if (active >= PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  active += 1;
  try {
    return await task();
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}

/** The Cache API exists only in secure contexts; elsewhere posters live for the session. */
async function posterCache(): Promise<Cache | null> {
  try {
    return typeof caches === "undefined" ? null : await caches.open(CACHE_NAME);
  } catch {
    return null;
  }
}

const cacheKey = (url: string) => `${CACHE_HOST}?src=${encodeURIComponent(url)}`;

/** With crossOrigin set, a host that sends no CORS headers fails the load instead of tainting the canvas. */
function firstFrame(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      resolve(blob);
    };
    const timer = window.setTimeout(() => finish(null), SETTLE_MS);
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("error", () => finish(null), { once: true });
    video.addEventListener("loadeddata", () => {
      video.currentTime = Number.isFinite(video.duration) && video.duration > 0 ? Math.min(0.05, video.duration / 2) : 0;
    }, { once: true });
    video.addEventListener("seeked", () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(video.videoWidth, video.videoHeight, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context || !video.videoWidth) return finish(null);
      try {
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => finish(blob), "image/webp", 0.8);
      } catch {
        finish(null);
      }
    }, { once: true });
    video.src = url;
  });
}

async function load(url: string): Promise<string | null> {
  const cache = await posterCache();
  const hit = await cache?.match(cacheKey(url)).catch(() => undefined);
  const blob = hit ? await hit.blob() : await slot(() => firstFrame(url));
  if (!blob) return null;
  if (!hit) void cache?.put(cacheKey(url), new Response(blob, { headers: { "Content-Type": blob.type } })).catch(() => undefined);
  const poster = URL.createObjectURL(blob);
  ready.set(url, poster);
  return poster;
}

export function videoPoster(url: string): Promise<string | null> {
  const known = ready.get(url);
  if (known) return Promise.resolve(known);
  let request = pending.get(url);
  if (!request) {
    request = load(url).finally(() => pending.delete(url));
    pending.set(url, request);
  }
  return request;
}

export function useVideoPoster(url: string | undefined): string | undefined {
  const [poster, setPoster] = useState<{ url: string; poster: string } | null>(null);
  useEffect(() => {
    if (!url || ready.has(url)) return;
    let live = true;
    void videoPoster(url).then((made) => { if (live && made) setPoster({ url, poster: made }); });
    return () => { live = false; };
  }, [url]);
  if (!url) return undefined;
  return ready.get(url) ?? (poster?.url === url ? poster.poster : undefined);
}
