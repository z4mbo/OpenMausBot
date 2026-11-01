"use client";

import { useEffect, useRef, type RefObject } from "react";
import { focusInitialInput, focusQuietly, wrapTab } from "@/lib/initial-focus";

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
      else if (root && !event.defaultPrevented) wrapTab(event, root);
    };
    document.addEventListener("keydown", handle);
    return () => { document.body.style.overflow = overflow; document.removeEventListener("keydown", handle); if (previous?.isConnected) focusQuietly(previous); };
  }, [ref]);
}
