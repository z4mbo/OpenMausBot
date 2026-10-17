"use client";

import { useEffect, useRef, type RefObject } from "react";
import { focusInitialInput } from "@/lib/initial-focus";

export function useModalKeyboard(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (root && !focusInitialInput(root)) root.focus({ preventScroll: true });
    const handle = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); }
      if (event.key !== "Tab" || !root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = focusable[0]; const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === root)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handle); if (previous?.isConnected) previous.focus(); };
  }, [ref]);
}
