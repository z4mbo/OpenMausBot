import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Check, CornerDownLeft, Trash2, X } from "lucide-react";
import { worldOrigin, type Scene } from "../../../../shared/canvas-scene";
import { cn } from "@/lib/cn";
import { toScreen, type Point, type View } from "./geometry";

export type Mention = { kind: "member" | "agent"; id: string; name: string };
export type CanvasComment = {
  _id: string; parentId?: string; nodeId?: string; x: number; y: number; authorId: string; authorName: string; agentName?: string;
  body: string; mentions: Mention[]; resolved: boolean; createdAt: number;
};
export type Draft = { world: Point; nodeId: string | null };

const surface = "rounded-xl border border-hairline/60 bg-menu";

/** Where a comment sits in world space: on its node (which may have moved since) or on the canvas. */
export function commentPoint(scene: Scene, comment: Pick<CanvasComment, "nodeId" | "x" | "y">): Point | null {
  if (!comment.nodeId) return { x: comment.x, y: comment.y };
  const node = scene.get(comment.nodeId);
  if (!node || node.deleted) return null;
  const origin = worldOrigin(scene, node);
  return { x: origin.x + comment.x, y: origin.y + comment.y };
}

function Composer({ people, placeholder, onSend, onCancel, autoFocus }: { people: readonly Mention[]; placeholder: string; onSend(body: string, mentions: Mention[]): Promise<void>; onCancel?: () => void; autoFocus?: boolean }) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Mention[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const query = /(?:^|\s)@([\w.-]*)$/.exec(body)?.[1];
  const options = query === undefined ? [] : people.filter((person) => person.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const [active, setActive] = useState(0);
  const choose = (person: Mention) => {
    setBody((text) => text.replace(/@([\w.-]*)$/, `@${person.name.replace(/\s+/g, "")} `));
    setPicked((list) => (list.some((item) => item.id === person.id) ? list : [...list, person]));
    setActive(0);
    area.current?.focus();
  };
  const send = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSend(text, picked.filter((person) => text.includes(`@${person.name.replace(/\s+/g, "")}`)));
      setBody("");
      setPicked([]);
    } finally { setBusy(false); }
  };
  const key = (event: ReactKeyboardEvent) => {
    event.stopPropagation();
    if (options.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) { event.preventDefault(); setActive((at) => (at + (event.key === "ArrowDown" ? 1 : options.length - 1)) % options.length); return; }
    if (options.length && (event.key === "Enter" || event.key === "Tab")) { event.preventDefault(); choose(options[Math.min(active, options.length - 1)]!); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); }
    if (event.key === "Escape") { event.preventDefault(); onCancel?.(); }
  };
  return (
    <div className="relative">
      <div className="flex items-end gap-1.5 rounded-lg bg-inset p-1.5 focus-within:ring-2 focus-within:ring-accent/50">
        <textarea ref={area} autoFocus={autoFocus} rows={1} value={body} placeholder={placeholder} aria-label={placeholder} disabled={busy}
          onChange={(event) => setBody(event.target.value)} onKeyDown={key}
          className="max-h-28 min-h-6 flex-1 resize-none bg-transparent text-[12.5px] leading-5 text-ink outline-none [field-sizing:content] placeholder:text-ink-tertiary" />
        <button type="button" aria-label="Post comment" disabled={!body.trim() || busy} onClick={() => void send()}
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink outline-none transition-opacity disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-accent/60"><CornerDownLeft size={12} /></button>
      </div>
      {options.length > 0 && (
        <ul role="listbox" aria-label="Mention" className={cn(surface, "absolute left-0 top-full z-10 mt-1 w-full p-1 animate-pop-in")}>
          {options.map((person, at) => (
            <li key={`${person.kind}-${person.id}`} role="option" aria-selected={at === active} onPointerDown={(event) => { event.preventDefault(); choose(person); }}
              className={cn("flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-[12.5px]", at === active ? "bg-raised text-ink" : "text-ink-secondary")}>
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <span className="text-[11px] text-ink-tertiary">{person.kind === "agent" ? "Agent" : "Member"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const when = (at: number) => new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** Comment pins over the stage, each opening its thread; with the comment tool, a click drops a new pin. */
export function CommentsLayer({ comments, scene, view, people, draft, userId, showResolved, onDraft, onSend, onResolve, onDelete }: {
  comments: readonly CanvasComment[]; scene: Scene; view: View; people: readonly Mention[]; draft: Draft | null; userId: string; showResolved: boolean;
  onDraft(draft: Draft | null): void;
  onSend(body: string, mentions: Mention[], at: { parentId?: string; draft?: Draft }): Promise<void>;
  onResolve(id: string, resolved: boolean): void;
  onDelete(id: string): void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const threads = useMemo(() => {
    const replies = new Map<string, CanvasComment[]>();
    for (const comment of comments) if (comment.parentId) replies.set(comment.parentId, [...(replies.get(comment.parentId) ?? []), comment]);
    return comments.filter((comment) => !comment.parentId && (showResolved || !comment.resolved || comment._id === open)).map((comment) => ({ root: comment, replies: replies.get(comment._id) ?? [] }));
  }, [comments, showResolved, open]);
  const card = (point: Point) => ({ left: Math.min(point.x + 18, window.innerWidth - 300), top: Math.max(8, point.y - 12) });
  return (
    <div data-canvas-chrome className="pointer-events-none absolute inset-0 z-[6] overflow-hidden">
      {threads.map(({ root, replies }, order) => {
        const world = commentPoint(scene, root);
        if (!world) return null;
        const point = toScreen(view, world);
        const chosen = open === root._id;
        return (
          <div key={root._id}>
            <button type="button" aria-label={`Comment by ${root.agentName ?? root.authorName}: ${root.body.slice(0, 60)}`} aria-expanded={chosen} data-comment-pin={root._id}
              onClick={() => { setOpen(chosen ? null : root._id); onDraft(null); }}
              className={cn("pointer-events-auto absolute flex h-7 min-w-7 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 px-1.5 text-[11px] font-semibold outline-none transition-transform duration-(--motion-fast) hover:scale-105 focus-visible:ring-2 focus-visible:ring-accent/60 motion-reduce:hover:scale-100",
                root.resolved ? "border-hairline bg-raised text-ink-tertiary" : "border-app bg-accent text-accent-ink")}
              style={{ left: point.x, top: point.y }}>
              {root.resolved ? <Check size={12} /> : (root.agentName ?? root.authorName).slice(0, 1).toUpperCase()}{replies.length > 0 && <span className="ml-0.5 tabular-nums">{replies.length + 1}</span>}
              <span className="sr-only">{order + 1}</span>
            </button>
            {chosen && (
              <section aria-label="Comment thread" className={cn(surface, "pointer-events-auto absolute z-10 flex w-[min(280px,calc(100vw-24px))] flex-col gap-2 p-2.5 animate-pop-in")} style={card(point)}
                onPointerDown={(event) => event.stopPropagation()}>
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-tertiary">{root.nodeId ? `On ${scene.get(root.nodeId)?.name ?? "a layer"}` : "On the canvas"}</span>
                  <button type="button" aria-label={root.resolved ? "Reopen thread" : "Resolve thread"} title={root.resolved ? "Reopen" : "Resolve"} onClick={() => onResolve(root._id, !root.resolved)}
                    className="inline-flex size-6 items-center justify-center rounded-md text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><Check size={13} /></button>
                  <button type="button" aria-label="Close thread" onClick={() => setOpen(null)} className="inline-flex size-6 items-center justify-center rounded-md text-ink-secondary outline-none hover:bg-raised hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/60"><X size={13} /></button>
                </div>
                <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto">
                  {[root, ...replies].map((comment) => (
                    <li key={comment._id} className="group">
                      <div className="flex items-baseline gap-1.5">
                        <strong className="text-[12px] font-medium text-ink">{comment.agentName ?? comment.authorName}</strong>
                        {comment.agentName && <span className="text-[10.5px] text-accent-text">Agent</span>}
                        <span className="text-[11px] text-ink-tertiary">{when(comment.createdAt)}</span>
                        {comment.authorId === userId && !comment.agentName && (
                          <button type="button" aria-label="Delete comment" onClick={() => onDelete(comment._id)} className="ml-auto inline-flex size-5 items-center justify-center rounded text-ink-tertiary opacity-0 outline-none hover:text-danger focus-visible:opacity-100 group-hover:opacity-100 touch:opacity-100"><Trash2 size={11} /></button>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink-secondary">{comment.body}</p>
                    </li>
                  ))}
                </ol>
                <Composer people={people} placeholder="Reply" onSend={(body, mentions) => onSend(body, mentions, { parentId: root._id })} />
              </section>
            )}
          </div>
        );
      })}
      {draft && (() => {
        const point = toScreen(view, draft.world);
        return (
          <>
            <span aria-hidden="true" className="absolute flex size-7 -translate-y-full items-center justify-center rounded-full rounded-bl-none border-2 border-app bg-accent" style={{ left: point.x, top: point.y }} />
            <section aria-label="New comment" className={cn(surface, "pointer-events-auto absolute z-10 w-[min(280px,calc(100vw-24px))] p-2 animate-pop-in")} style={card(point)} onPointerDown={(event) => event.stopPropagation()}>
              <Composer autoFocus people={people} placeholder={draft.nodeId ? `Comment on ${scene.get(draft.nodeId)?.name ?? "layer"}, @ to mention` : "Comment, @ to mention"}
                onSend={async (body, mentions) => { await onSend(body, mentions, { draft }); onDraft(null); }} onCancel={() => onDraft(null)} />
            </section>
          </>
        );
      })()}
    </div>
  );
}
