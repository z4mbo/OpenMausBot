"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { focusInitialInput, focusQuietly, wrapTab } from "@/lib/initial-focus";

/** Where focus goes when a dialog closes: its opener, the same issue card re-rendered, else the main heading. */
export function restoreFocus(opener: Element | null, taskId?: string | null) {
  const focus = (element: HTMLElement | null | undefined) => {
    if (!element?.isConnected || element.closest("[inert], [hidden]") || !element.getClientRects().length) return false;
    return focusQuietly(element);
  };
  if (opener instanceof HTMLElement && opener !== document.body && focus(opener)) return;
  if (taskId && focus(document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`))) return;
  const heading = document.querySelector<HTMLElement>("main h1, main [role=heading]");
  if (heading) {
    if (!heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1");
    focus(heading);
  }
}

export function Dialog({ title, heading, children, onClose, className = "" }: { title: string; heading?: ReactNode; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  // Captured during render, before the dialog or its autofocus fields take focus.
  const [opener] = useState(() => typeof document === "undefined" ? null : document.activeElement);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const taskId = opener instanceof HTMLElement ? opener.closest<HTMLElement>("[data-task-id]")?.dataset.taskId : undefined;
    let unmounting = false;
    element.showModal();
    // Native modal focus runs after React autofocus; retry when async fields arrive.
    let observer: MutationObserver | undefined;
    if (!focusInitialInput(element)) {
      const initial = document.activeElement;
      observer = new MutationObserver(() => {
        if (document.activeElement !== initial && document.activeElement !== element) observer?.disconnect();
        else if (focusInitialInput(element)) observer?.disconnect();
      });
      observer.observe(element, { childList: true, subtree: true });
    }
    // The browser can close a modal on its own (Chrome's close watcher after repeated Escapes). Tell React, and
    // reopen when the owner keeps the dialog (for example an issue with unsaved required fields).
    const onNativeClose = () => {
      // A close queued before a reopen (React StrictMode remounts) is stale.
      if (unmounting || element.open) return;
      close.current();
      setTimeout(() => { if (!unmounting && element.isConnected && !element.open) element.showModal(); }, 0);
    };
    element.addEventListener("close", onNativeClose);
    // A modal <dialog> lets Tab leave for the browser UI and <body>; keep it cycling through the dialog.
    // Native listener: React events would also bubble here from dialogs portaled out of this one.
    const onKeyDown = (event: KeyboardEvent) => { if (!event.defaultPrevented) wrapTab(event, element); };
    element.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      unmounting = true;
      observer?.disconnect();
      element.removeEventListener("close", onNativeClose);
      element.removeEventListener("keydown", onKeyDown);
      if (element.open) element.close();
      document.body.style.overflow = previous;
      // Another dialog opened from this one takes care of its own focus.
      if (!document.querySelector("dialog[open]")) restoreFocus(opener, taskId);
    };
  }, [opener]);
  return createPortal(<dialog ref={ref} className={`origin-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header className="dialog-heading">{heading || <h2>{title}</h2>}<button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
    {children}
  </dialog>, document.body);
}
