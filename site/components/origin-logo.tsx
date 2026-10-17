"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import st from "./logo.module.css";

type Look = { x: number; y: number };

const GLANCES: Look[] = [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: -0.7, y: -0.6 }, { x: 0.7, y: -0.6 }, { x: 0, y: 0.6 }, { x: -0.8, y: 0.35 }, { x: 0.8, y: 0.35 }];
const POINTER_REACH = 360;
const POINTER_IDLE_MS = 3200;

const logos = new Set<SVGSVGElement>();
let pointer: Look | null = null;
let lastPointerMove = 0;
let frame = 0;

function setLook(logo: SVGSVGElement, look: Look) {
  logo.style.setProperty("--look-x", look.x.toFixed(3));
  logo.style.setProperty("--look-y", look.y.toFixed(3));
}

function aimAtPointer() {
  frame = 0;
  if (!pointer) return;
  for (const logo of logos) {
    const box = logo.getBoundingClientRect();
    if (box.bottom < 0 || box.top > innerHeight) continue;
    const dx = pointer.x - (box.left + box.width / 2);
    const dy = pointer.y - (box.top + box.height / 2);
    const distance = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, distance / POINTER_REACH);
    setLook(logo, { x: (dx / distance) * reach, y: (dy / distance) * reach });
  }
}

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY };
  lastPointerMove = performance.now();
  if (!frame) frame = requestAnimationFrame(aimAtPointer);
}

function track(logo: SVGSVGElement) {
  if (logos.size === 0) window.addEventListener("pointermove", onPointerMove, { passive: true });
  logos.add(logo);
  return () => {
    logos.delete(logo);
    if (logos.size === 0) window.removeEventListener("pointermove", onPointerMove);
  };
}

/** The Origin mark: a black tile with a face that blinks, glances around and follows the pointer. */
export function OriginLogo({ size = 28, label, still = false, className }: { size?: number; label?: string; still?: boolean; className?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const logo = ref.current;
    if (!logo || still || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    logo.style.setProperty("--blink-delay", `${(Math.random() * 4).toFixed(2)}s`);
    const untrack = track(logo);
    let timer = 0;
    const glance = () => {
      const pointerIsIdle = performance.now() - lastPointerMove > POINTER_IDLE_MS;
      if (pointerIsIdle && !document.hidden) {
        const look = GLANCES[Math.floor(Math.random() * GLANCES.length)];
        setLook(logo, { x: look.x * 0.85, y: look.y * 0.85 });
        timer = window.setTimeout(() => {
          if (performance.now() - lastPointerMove > POINTER_IDLE_MS) setLook(logo, { x: 0, y: 0 });
          timer = window.setTimeout(glance, 1800 + Math.random() * 2600);
        }, 700 + Math.random() * 700);
        return;
      }
      timer = window.setTimeout(glance, 1500);
    };
    timer = window.setTimeout(glance, 1200 + Math.random() * 1800);
    return () => { untrack(); window.clearTimeout(timer); };
  }, [still]);
  const labelled = label ? { role: "img", "aria-label": label } : { "aria-hidden": true };
  return (
    <svg ref={ref} className={clsx(st.logo, className)} width={size} height={size} viewBox="0 0 64 64" fill="none" {...labelled}>
      <rect width="64" height="64" rx="14.5" fill="#111111" />
      <rect x="0.5" y="0.5" width="63" height="63" rx="14" stroke="#ffffff" strokeOpacity="0.12" />
      <g className={still ? undefined : st.face}>
        <circle cx="32" cy="32" r="18.75" fill="#ffffff" />
        <g className={still ? undefined : st.eyes}>
          <g className={still ? undefined : st.lids}>
            <ellipse cx="27.375" cy="30.75" rx="2.125" ry="3.25" fill="#050505" />
            <ellipse cx="36.625" cy="30.75" rx="2.125" ry="3.25" fill="#050505" />
          </g>
        </g>
      </g>
    </svg>
  );
}
