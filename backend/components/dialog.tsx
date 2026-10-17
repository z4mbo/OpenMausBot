"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { focusInitialInput } from "@/lib/initial-focus";

export function Dialog({ title, heading, children, onClose, className = "" }: { title: string; heading?: ReactNode; children: ReactNode; onClose: () => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    // Native modal focus runs after React autofocus; retry when async fields arrive.
    let observer: MutationObserver | undefined;
    if (element && !focusInitialInput(element)) {
      const initial = document.activeElement;
      observer = new MutationObserver(() => {
        if (document.activeElement !== initial && document.activeElement !== element) observer?.disconnect();
        else if (focusInitialInput(element)) observer?.disconnect();
      });
      observer.observe(element, { childList: true, subtree: true });
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { observer?.disconnect(); element?.close(); document.body.style.overflow = previous; };
  }, []);
  return createPortal(<dialog ref={ref} className={`origin-dialog ${className}`} aria-label={title} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header className="dialog-heading">{heading || <h2>{title}</h2>}<button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></header>
    {children}
  </dialog>, document.body);
}
