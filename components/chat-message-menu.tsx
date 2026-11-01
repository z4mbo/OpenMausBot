"use client";

import { useLayoutEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { CirclePlus, Copy, Eye, Heart, PartyPopper, Pencil, Pin, PinOff, Reply, ThumbsUp, Trash2 } from "lucide-react";
import { isSheetLayout } from "./use-anchored-popover";

/** The reactions the chat store accepts (`editLocalMessage`), in toolbar order. */
export const CHAT_REACTIONS = [
  { key: "like", label: "Like", Icon: ThumbsUp },
  { key: "heart", label: "Love", Icon: Heart },
  { key: "celebrate", label: "Celebrate", Icon: PartyPopper },
  { key: "eyes", label: "Looking", Icon: Eye },
] as const;

export type MessageAction = "reply" | "copy" | "issue" | "pin" | "edit" | "delete" | `react:${string}`;
/** Viewport box the menu opens from (a button or the pointer); null opens the phone sheet. */
export type MessageMenuAnchor = { left: number; top: number; right: number; bottom: number } | null;

const items = (menu: HTMLElement | null) => Array.from(menu?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);

/**
 * Message actions: the ⋯ button or right-click on desktop, a long-press on touch screens (a bottom sheet with the
 * reactions on top). Same layer and scrim behaviour as the board's card menu.
 */
export function MessageMenu({ anchor, preview, own, pinned, reacted, canCreateIssue, onAction, onClose }: {
  anchor: MessageMenuAnchor; preview: string; own: boolean; pinned: boolean; reacted: (key: string) => boolean;
  canCreateIssue: boolean; onAction: (action: MessageAction) => void; onClose: (restoreFocus: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const sheet = anchor === null || isSheetLayout();
  const tap = useRef(false);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    if (!sheet && anchor) {
      const width = element.offsetWidth, height = element.offsetHeight;
      const below = anchor.bottom + 4 + height <= window.innerHeight - 8;
      const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
      Object.assign(element.style, { left: `${left}px`, top: `${below ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)}px` });
    }
    // A sheet opened by touch keeps focus off its items (no ring flash); keyboard and mouse menus focus the first one.
    if (!sheet) items(element).find(item => item.getAttribute("role") === "menuitem")?.focus({ preventScroll: true });
    else element.focus({ preventScroll: true });
  }, [anchor, sheet]);
  // A sheet opens under the finger that held the message; ignore a press that arrives before the finger has lifted.
  const openedAt = useRef(0);
  useLayoutEffect(() => { openedAt.current = performance.now(); }, []);
  const run = (action: MessageAction) => {
    if (sheet && performance.now() - openedAt.current < 300) return;
    onAction(action);
    onClose(action !== "edit" && action !== "reply");
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const all = items(menu.current);
    const index = all.indexOf(document.activeElement as HTMLElement);
    const move = (next: number) => { event.preventDefault(); all[(next + all.length) % all.length]?.focus({ preventScroll: true }); };
    if (event.key === "Escape") { event.preventDefault(); onClose(true); }
    else if (event.key === "Tab") { event.preventDefault(); onClose(true); }
    else if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index < 0 ? all.length - 1 : index - 1);
    else if (event.key === "ArrowRight" && index >= 0 && index < CHAT_REACTIONS.length) move(index + 1);
    else if (event.key === "ArrowLeft" && index > 0 && index < CHAT_REACTIONS.length) move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(all.length - 1);
  };
  return createPortal(<div className={`message-menu-layer ${sheet ? "is-sheet" : ""}`} onContextMenu={event => { event.preventDefault(); onClose(false); }}>
    {/* A mouse closes on press; a tap closes on its click, so the click after the tap lands here and not underneath. */}
    <div className="message-menu-scrim" onPointerDown={event => {
      event.preventDefault();
      tap.current = event.pointerType !== "mouse";
      if (!tap.current) onClose(false);
    }} onClick={() => { if (tap.current) onClose(false); }} />
    <div ref={menu} role="menu" tabIndex={-1} aria-label="Message actions" className="origin-dropdown message-menu" onKeyDown={onKeyDown}>
      {sheet && preview && <div className="message-menu-preview">{preview}</div>}
      <div className="message-menu-reactions" role="group" aria-label="React">
        {CHAT_REACTIONS.map(({ key, label, Icon }) => <button key={key} type="button" role="menuitemcheckbox" aria-checked={reacted(key)} aria-label={label} title={sheet ? undefined : label} onClick={() => run(`react:${key}`)}><Icon size={sheet ? 20 : 16} /></button>)}
      </div>
      <button type="button" role="menuitem" onClick={() => run("reply")}><Reply size={15} /><span>Reply</span></button>
      <button type="button" role="menuitem" onClick={() => run("copy")}><Copy size={15} /><span>Copy text</span></button>
      {canCreateIssue && <button type="button" role="menuitem" onClick={() => run("issue")}><CirclePlus size={15} /><span>Create issue</span></button>}
      <button type="button" role="menuitem" onClick={() => run("pin")}>{pinned ? <PinOff size={15} /> : <Pin size={15} />}<span>{pinned ? "Unpin" : "Pin"}</span></button>
      {own && <>
        <hr />
        <button type="button" role="menuitem" onClick={() => run("edit")}><Pencil size={15} /><span>Edit</span></button>
        <button type="button" role="menuitem" className="danger-text" onClick={() => run("delete")}><Trash2 size={15} /><span>Delete</span></button>
      </>}
    </div>
  </div>, document.body);
}
