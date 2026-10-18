import { createContext, createElement, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";

type PanelRef = RefObject<HTMLElement | null>;
interface ModalOptions {
  open?: boolean;
  initialFocusRef?: PanelRef;
  returnFocusRef?: PanelRef;
  fallbackFocusRef?: PanelRef;
  canClose?: () => boolean;
  restoreFocus?: () => boolean;
}
interface Layer { panel: HTMLElement; parent: PanelRef | null; dismiss: () => void }
const ParentDialog = createContext<PanelRef | null>(null);
const layers = new WeakMap<Document, Layer[]>();

function usable(element: HTMLElement | null): element is HTMLElement {
  if (!element?.isConnected || element.matches(":disabled, input[type='hidden']")) return false;
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    if (parent.hidden || parent.inert) return false;
    const style = getComputedStyle(parent);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
  }
  return true;
}

function tabStops(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]")]
    .filter((element) => element.tabIndex >= 0 && usable(element));
}

function topLayer(document: Document): Layer | undefined {
  const active = (layers.get(document) ?? []).filter((layer) => layer.panel.isConnected);
  return active.findLast((layer) => !active.some((child) => child.parent?.current === layer.panel));
}

function focusPanel(panel: HTMLElement) {
  (tabStops(panel)[0] ?? panel).focus();
}

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || (event.key !== "Escape" && event.key !== "Tab")) return;
  const document = (event.currentTarget as Window).document;
  const layer = topLayer(document);
  if (!layer) return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    layer.dismiss();
    return;
  }
  const controls = tabStops(layer.panel);
  const current = document.activeElement as HTMLElement | null;
  const first = controls[0], last = controls.at(-1);
  if (!first || !last) {
    event.preventDefault();
    layer.panel.focus({ preventScroll: true });
  } else if (!current || !controls.includes(current)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && current === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && current === last) {
    event.preventDefault();
    first.focus();
  }
}

export function ModalFocusScope({ panelRef, children }: { panelRef: PanelRef; children: ReactNode }) {
  return createElement(ParentDialog.Provider, { value: panelRef }, children);
}

export function useModalDialog(dialogRef: PanelRef, onClose: () => void, options: ModalOptions = {}) {
  const parent = useContext(ParentDialog);
  const latest = useRef({ onClose, options });
  latest.current = { onClose, options };
  const open = options.open !== false;
  const opened = useRef(false);
  const opener = useRef<HTMLElement | null>(null);
  if (open && !opened.current) opener.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  opened.current = open;
  const layerRef = useRef<Layer | null>(null);
  const dismiss = () => {
    if (latest.current.options.canClose?.() !== false) latest.current.onClose();
  };
  useEffect(() => {
    const panel = dialogRef.current;
    if (!open || !panel) return;
    const document = panel.ownerDocument;
    const window = document.defaultView!;
    const active = layers.get(document) ?? [];
    if (!active.length) window.addEventListener("keydown", onKey);
    layers.set(document, active);
    const layer: Layer = { panel, parent, dismiss: () => {
      if (latest.current.options.canClose?.() !== false) latest.current.onClose();
    } };
    active.push(layer);
    layerRef.current = layer;
    if (topLayer(document) === layer) {
      const initial = latest.current.options.initialFocusRef?.current;
      if (usable(initial ?? null) && panel.contains(initial!)) initial!.focus();
      else if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });
    }
    const returnTo = opener.current;
    return () => {
      const index = active.indexOf(layer);
      if (index !== -1) active.splice(index, 1);
      if (!active.length) window.removeEventListener("keydown", onKey);
      if (layerRef.current === layer) layerRef.current = null;
      const restore = () => {
        if ((panel.isConnected && opened.current) || latest.current.options.restoreFocus?.() === false) return;
        const top = topLayer(document);
        const current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (current !== document.body && usable(current) && !panel.contains(current) && (!top || top.panel.contains(current))) return;
        const targets = [latest.current.options.returnFocusRef?.current, returnTo, latest.current.options.fallbackFocusRef?.current];
        const target = targets.find((candidate) => candidate !== document.body && usable(candidate ?? null) && (!top || top.panel.contains(candidate!)));
        if (target) target.focus({ preventScroll: true });
        else if (top) focusPanel(top.panel);
      };
      if (!panel.isConnected || !opened.current) restore();
      else queueMicrotask(restore);
    };
  }, [dialogRef, open, parent]);
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer || topLayer(layer.panel.ownerDocument) !== layer) return;
    const current = layer.panel.ownerDocument.activeElement;
    if (current === layer.panel.ownerDocument.body || (current instanceof HTMLElement && layer.panel.contains(current) && !usable(current))) layer.panel.focus({ preventScroll: true });
  });
  return { dismiss, focus: () => {
    const layer = layerRef.current;
    if (layer && topLayer(layer.panel.ownerDocument) === layer) layer.panel.focus({ preventScroll: true });
  } };
}
