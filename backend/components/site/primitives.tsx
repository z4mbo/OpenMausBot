"use client";

import { useEffect, useRef, useState } from "react";

export const GITHUB_URL = "https://github.com/z4mbo/origin-workspace";
export const githubDoc = (path: string) => `${GITHUB_URL}/blob/main/${path}`;

export function GitHubMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/** Observe an element once (or continuously) and report whether it is on screen. */
export function useInView<T extends Element>({ once = true, rootMargin = "0px 0px -12% 0px", threshold = 0 }: { once?: boolean; rootMargin?: string; threshold?: number } = {}) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        if (once) observer.disconnect();
      } else if (!once) setInView(false);
    }, { rootMargin, threshold });
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, rootMargin, threshold]);
  return [ref, inView] as const;
}

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

/** Tween a number whenever its value changes. */
export function Count({ value, suffix = "" }: { value: number; suffix?: string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / 700);
      const eased = 1 - Math.pow(1 - progress, 3);
      const next = Math.round(origin + (value - origin) * eased);
      setShown(next);
      from.current = next;
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}{suffix}</>;
}

function random(seed: number) {
  let state = seed % 2147483647 || 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

/** A hand-drawn rounded rectangle in the spirit of Excalidraw's rough strokes. */
export function roughRect(x: number, y: number, w: number, h: number, seed = 1, r = 12) {
  const rand = random(seed);
  const j = (amount = 2.2) => ((rand() - 0.5) * amount).toFixed(1);
  const n = (value: number, amount?: number) => (value + Number(j(amount))).toFixed(1);
  return [
    `M${n(x + r + 4)} ${n(y)}`,
    `L${n(x + w - r)} ${n(y)}`,
    `Q${n(x + w)} ${n(y)} ${n(x + w)} ${n(y + r)}`,
    `L${n(x + w)} ${n(y + h - r)}`,
    `Q${n(x + w)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)}`,
    `L${n(x + r)} ${n(y + h)}`,
    `Q${n(x)} ${n(y + h)} ${n(x)} ${n(y + h - r)}`,
    `L${n(x)} ${n(y + r)}`,
    `Q${n(x)} ${n(y)} ${n(x + r + 10, 4)} ${n(y - 1, 3)}`,
  ].join(" ");
}

/** A slightly bowed line with an optional open arrow head. */
export function roughArrow(x1: number, y1: number, x2: number, y2: number, seed = 1, bow = 10, head = true) {
  const rand = random(seed);
  const mx = (x1 + x2) / 2 + (rand() - 0.5) * 4;
  const my = (y1 + y2) / 2 - bow;
  const line = `M${x1} ${y1} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2} ${y2}`;
  if (!head) return line;
  const angle = Math.atan2(y2 - my, x2 - mx);
  const size = 11;
  const a1 = angle + Math.PI - 0.45;
  const a2 = angle + Math.PI + 0.45;
  return `${line} M${(x2 + Math.cos(a1) * size).toFixed(1)} ${(y2 + Math.sin(a1) * size).toFixed(1)} L${x2} ${y2} L${(x2 + Math.cos(a2) * size).toFixed(1)} ${(y2 + Math.sin(a2) * size).toFixed(1)}`;
}
