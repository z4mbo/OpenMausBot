import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, Loader2, Send, Sparkles, X } from "lucide-react";
import { compactScene } from "../../../../shared/canvas-ops";
import { originIssueKey } from "../../../../shared/origin-issues";
import { useCloudQuery } from "@/lib/origin-cloud";
import { composeMessage, imageAttachmentFromFile } from "@/lib/composer-attachments";
import { setChiefSectionOf } from "@/lib/origin-chief-section";
import { openOriginPage } from "@/lib/origin-pages";
import { useShowThreads } from "@/lib/thread-preferences";
import { useThreadTranscript } from "@/lib/thread-transcript";
import { openBot } from "@/state/thread-navigation";
import { useStore, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { BotAvatar } from "../../Avatar";
import { Select } from "../../Select";
import { errorText } from "../repo-url";
import { Notice, iconButton, inputClass, primaryButton } from "../ui";
import { topmost } from "./actions";
import { exportSvg, fileSafe, svgToPng } from "./export";
import type { CanvasScene } from "./use-canvas-scene";

const JSON_MAX = 8_000;
type Issue = { _id: string; title: string; done: boolean };

/** The request an agent gets about the canvas: the person's ask, where it is, and the layers in scope as compact JSON. */
export function canvasRequest({ asked, scope, name, canvasId, json, issue }: { asked: string; scope: string; name: string; canvasId?: string; json: string; issue?: Issue }) {
  const layers = json.length > 2 ? `\nLayers (x, y relative to their parent):\n\`\`\`json\n${json.length > JSON_MAX ? `${json.slice(0, JSON_MAX)}…` : json}\n\`\`\`` : "\nThe canvas is empty.";
  const where = `This is ${scope} on the shared "${name}" canvas${canvasId ? ` (canvas ${canvasId})` : ""}. You can change it directly with origin_canvas_edit and read it with origin_canvas; check your work with origin_canvas_screenshot. People watch your changes land live.`;
  const design = issue ? `\n\nDesign issue ${originIssueKey(issue._id)} (${issue._id}) "${issue.title}": build the screens as frames on this canvas, then link each frame with origin_design_submit (issue ${issue._id}) and explain your choices in its rationale; that asks the Chief to review.` : "";
  return `${asked}\n\n${where}${design}${layers}`;
}

function Reply({ message }: { message: Message }) {
  if (message.role === "user") return <p className="ml-6 self-end whitespace-pre-wrap rounded-lg rounded-br-sm bg-accent/15 px-2.5 py-1.5 text-[12.5px] text-ink">{(message.text ?? "").split("\n\nThis is ")[0]}</p>;
  if (message.kind === "activity" && message.tool) {
    return (
      <p className="flex items-center gap-1.5 text-[11.5px] text-ink-tertiary">
        <span className={cn("size-1.5 rounded-full", message.tool.ok === false ? "bg-danger" : "bg-accent")} />
        {message.tool.name.startsWith("origin_canvas") ? (message.tool.name === "origin_canvas_edit" ? "Edited the canvas" : message.tool.name === "origin_canvas_screenshot" ? "Looked at a screenshot" : "Read the canvas") : message.tool.name.replace(/_/g, " ")}
      </p>
    );
  }
  if (!message.text) return null;
  return <p className="whitespace-pre-wrap text-[12.5px] leading-5 text-ink-secondary">{message.text}</p>;
}

/** A side panel to brief an agent about the canvas and watch it work: its edits stream onto the canvas under its cursor. */
export const AGENT_PANEL_WIDTH = 340;

export function AgentPanel({ agent: lead, team = [], canvas, selected, images, name, canvasId, projectId, onClose }: {
  agent: Bot; team?: readonly Bot[]; canvas: CanvasScene; selected: readonly string[]; images: ReadonlyMap<string, string>; name: string; canvasId?: string; projectId?: string; onClose(): void;
}) {
  const nodes = topmost(canvas.scene, selected);
  const { state, dispatch } = useStore();
  const showThreads = useShowThreads();
  const agents = team.some((bot) => bot.id === lead.id) ? team : [lead, ...team];
  const [chosen, setChosen] = useState(lead.id);
  const agent = agents.find((bot) => bot.id === chosen) ?? lead;
  const live = state?.bots?.find((bot) => bot.id === agent.id) ?? agent;
  const board = useCloudQuery<{ tasks: Issue[] }>("tasks:board", projectId ? { projectId } : "skip");
  const issues = (board?.tasks ?? []).filter((task) => !task.done).slice(0, 100);
  const [question, setQuestion] = useState("");
  const [issue, setIssue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ id: string; botId: string; threadId?: string; text: string } | null>(null);
  const exporting = useRef(false);
  const generation = useRef(0);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => () => { generation.current++; }, []);
  const scope = nodes.length ? (nodes.length === 1 ? `"${nodes[0]!.name}"` : `${nodes.length} selected layers`) : "the whole canvas";
  const transcript = useThreadTranscript(sent?.threadId);
  const askedBot = sent ? state?.bots?.find((bot) => bot.id === sent.botId) : undefined;
  const messages = transcript ?? (askedBot?.threadId === sent?.threadId ? askedBot?.messages : undefined) ?? [];
  const from = sent ? messages.findIndex((message) => message.sendId === sent.id || message.id === sent.id) : -1;
  const conversation = from >= 0 ? messages.slice(from) : sent ? [{ id: `pending-${sent.id}`, role: "user", kind: "text", text: sent.text } as Message] : [];
  const working = Boolean((askedBot ?? live).busy);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [conversation.length]);

  const close = () => { generation.current++; exporting.current = false; setBusy(false); onClose(); };
  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (exporting.current) return;
    exporting.current = true;
    const request = ++generation.current;
    setBusy(true);
    setError("");
    try {
      const snapshot = await exportSvg(canvas.scene, canvas.index, nodes.map((node) => node.id), images);
      if (request !== generation.current) return;
      const image = snapshot ? await imageAttachmentFromFile(new File([await svgToPng(snapshot, 1.5)], `${fileSafe(name)}.png`, { type: "image/png" })) : null;
      if (request !== generation.current) return;
      if (snapshot && !image) throw new Error("Could not attach the snapshot");
      const json = JSON.stringify(nodes.length ? nodes.flatMap((node) => compactScene(canvas.scene, { root: node.id, max: 200 }).nodes) : compactScene(canvas.scene, { max: 200 }).nodes);
      const chosen = issues.find((item) => item._id === issue);
      const asked = question.trim() || (chosen ? `Design ${chosen.title}.` : "What do you make of this design? Point out gaps and improve it.");
      const sendId = crypto.randomUUID();
      dispatch({ type: "send", botId: agent.id, sendId, text: composeMessage(canvasRequest({ asked, scope, name, canvasId, json, issue: chosen }), image ? [image] : []) });
      setSent({ id: sendId, botId: agent.id, threadId: live.threadId, text: asked });
      setQuestion("");
      setIssue("");
    } catch (cause) {
      if (request === generation.current) setError(errorText(cause, "Could not share the canvas"));
    } finally {
      if (request === generation.current) { exporting.current = false; setBusy(false); }
    }
  };
  const openChat = () => { if (agent.chiefOfStaff) setChiefSectionOf(agent.id, "chat"); openOriginPage(null); openBot(dispatch, agent, showThreads); };
  return (
    <aside aria-label={`Ask ${agent.name}`} data-agent-panel style={{ width: `min(${AGENT_PANEL_WIDTH}px, 100%)` }} className="absolute inset-y-0 right-0 z-30 flex flex-col border-l border-hairline/40 bg-panel origin-overlay-in">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-hairline/40 px-3">
        <BotAvatar bot={agent} size={26} animated={working} />
        <div className="min-w-0 flex-1">
          {agents.length > 1 ? (
            <Select size="sm" aria-label="Agent to ask" value={agent.id} disabled={busy} onChange={(event) => { setChosen(event.target.value); setSent(null); }} className="max-w-full">
              {agents.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}{bot.title ? ` · ${bot.title}` : ""}</option>)}
            </Select>
          ) : <strong className="block truncate text-[13px] text-ink">{agent.name}</strong>}
          <span className="block truncate text-[11.5px] text-ink-tertiary">{working ? "Working on the canvas" : `About ${scope}`}</span>
        </div>
        <button type="button" className={iconButton} aria-label="Open chat" title="Open the full chat" onClick={openChat}><ArrowUpRight size={14} /></button>
        <button type="button" className={iconButton} aria-label="Close" onClick={close}><X size={14} /></button>
      </div>
      <div ref={list} aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3">
        {conversation.length ? conversation.map((message) => <Reply key={message.id} message={message} />) : (
          <p className="m-auto max-w-56 text-center text-[12.5px] leading-5 text-ink-tertiary">{agent.name} edits this canvas live; select layers to focus the ask.</p>
        )}
        {working && sent && <p className="flex items-center gap-1.5 text-[11.5px] text-ink-tertiary"><Loader2 size={12} className="animate-spin" />Designing</p>}
      </div>
      <form onSubmit={(event) => void send(event)} aria-label={`Ask ${agent.name} about this canvas`} className="flex shrink-0 flex-col gap-2 border-t border-hairline/40 p-3"
        onKeyDown={(event) => { event.stopPropagation(); if (event.key === "Escape") { event.preventDefault(); close(); } }}>
        {issues.length > 0 && (
          <Select size="sm" aria-label="Design an issue" value={issue} disabled={busy} onChange={(event) => setIssue(event.target.value)}>
            <option value="">No issue</option>
            {issues.map((item) => <option key={item._id} value={item._id}>Design {originIssueKey(item._id)} {item.title}</option>)}
          </Select>
        )}
        <textarea autoFocus rows={3} className={cn(inputClass, "resize-none")} aria-label="Question" placeholder="Design a pricing section next to this…" value={question} disabled={busy}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        {error && <Notice tone="danger">{error}</Notice>}
        <button className={cn(primaryButton, "self-end rounded-full px-4")} disabled={busy}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}Send to {agent.name}
        </button>
      </form>
    </aside>
  );
}

export function AskAgentButton({ agent, open, onToggle }: { agent: Bot; open: boolean; onToggle(): void }) {
  return (
    <button type="button" aria-label={`Ask ${agent.name}`} aria-expanded={open} onClick={onToggle}
      className={cn("group flex h-8 items-center gap-1.5 rounded-lg border border-accent/35 bg-accent/10 py-1 pl-1 pr-3 text-[12.5px] font-medium text-accent-text outline-none transition-[background-color,transform] duration-150 hover:bg-accent/20 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent/60", open && "bg-accent/20")}>
      <BotAvatar bot={agent} size={22} animated={false} />
      <Sparkles size={13} aria-hidden="true" className="transition-transform duration-150 group-hover:rotate-12" /><span className="truncate">Ask {agent.name}</span>
    </button>
  );
}
