"use client";

import { useEffect, type RefObject } from "react";
import { hasOpenKeyboardOverlay, isEditingTarget, shouldFocusChatComposer } from "@/lib/keyboard-navigation";

export function useChatTypingFocus(ref: RefObject<HTMLTextAreaElement | null>, canWrite: boolean) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const input = ref.current;
      if (!input || input.disabled || input.readOnly || !input.getClientRects().length || getComputedStyle(input).visibility === "hidden") return;
      const active = document.activeElement;
      if (!shouldFocusChatComposer(event, {
        canWrite,
        editing: isEditingTarget(event.target) || isEditingTarget(active),
        overlayOpen: hasOpenKeyboardOverlay(),
        controlHasFocus: Boolean(active?.closest('button, a, [role="button"]')),
      })) return;
      // Focus before the browser inserts the key, preserving the first character and native undo.
      input.focus({ preventScroll: true });
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [ref, canWrite]);
}
