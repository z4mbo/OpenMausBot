import { Brush, Headset, Inbox, MessageCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { openOriginPage, useOriginPage, type OriginPage } from "@/lib/origin-pages";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { activeWorkspace, useWorkspaces, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { useStore } from "@/state/store";
import type { SidebarDensity } from "@/lib/sidebar-preferences";
import { sidebarRowLead } from "@/lib/sidebar-row-geometry";
import { useShowThreads } from "@/lib/thread-preferences";
import { MemberCall } from "./origin-pages/CallPage";
import { WorkspaceChat } from "./origin-pages/WorkspaceChatPage";
import { WorkspaceInbox } from "./origin-pages/WorkspaceInboxPage";
import { WorkspaceGate } from "./origin-pages/ui";
import { DrawingCanvas } from "./OriginDraw";
import { useBotColor } from "@/lib/origin-avatar-looks";
import { accentVars } from "@/lib/user-bubble-tone";

export const ORIGIN_PAGES: { id: OriginPage; label: string; contents: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", contents: "Issues and notifications", icon: Inbox },
  { id: "chat", label: "Chat", contents: "Messages", icon: MessageCircle },
  { id: "call", label: "Call", contents: "Calls", icon: Headset },
  { id: "draw", label: "Draw", contents: "Drawings", icon: Brush },
];

export function OriginNav({ density }: { density: SidebarDensity }) {
  const open = useOriginPage();
  const lead = sidebarRowLead(density, useShowThreads());
  const iconsOnly = density === "icons";
  const { state } = useStore();
  const { head } = useActiveCloudWorkspace();
  const accent = accentVars(useBotColor(state.bots.find((bot) => bot.id === head?.id)));
  return (
    <nav aria-label="Workspace" data-origin-nav style={accent} className={cn("flex flex-col gap-0.5", iconsOnly ? "items-center py-1" : "pb-1 pt-1.5")}>
      {ORIGIN_PAGES.map(({ id, label, icon: Icon }) => {
        const active = open === id;
        return (
          <button key={id} type="button" aria-current={active ? "page" : undefined} title={iconsOnly ? label : undefined} aria-label={iconsOnly ? label : undefined}
            data-origin-nav-item={id} onClick={() => openOriginPage(id)}
            className={cn("group flex items-center rounded-xl outline-none transition-[background-color,transform] duration-150 active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-accent/60 motion-reduce:active:scale-100",
              iconsOnly ? "size-[46px] justify-center" : cn("w-full py-1 pr-3 text-left", lead.padding, lead.gap),
              active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50")}>
            <span className="flex shrink-0 items-center justify-center" style={iconsOnly ? undefined : { width: lead.size, height: Math.min(lead.size, 32) }}>
              <Icon size={20} aria-hidden="true" className={cn("transition-colors duration-150 motion-reduce:transition-none", active ? "text-ink" : "text-ink-secondary group-hover:text-ink")} />
            </span>
            {!iconsOnly && <span className="flex-1 truncate text-[14px] font-medium leading-5">{label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

export function OriginPageView({ page }: { page: OriginPage }) {
  const entry = ORIGIN_PAGES.find((item) => item.id === page)!;
  const Icon = entry.icon;
  const { teamId, head } = useActiveCloudWorkspace();
  const { state } = useStore();
  const headBot = state.bots.find((bot) => bot.id === head?.id);
  const accent = accentVars(useBotColor(headBot));
  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app" data-origin-page={page} style={accent}>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-hairline/40 px-4 pl-11 md:pl-5">
        <span key={page} className="flex size-8 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Icon size={18} aria-hidden="true" /></span>
        <h1 key={`${page}-title`} className="text-[15px] font-semibold text-ink origin-rise">{entry.label}</h1>
        <span className="hidden truncate text-[12.5px] text-ink-tertiary sm:inline">· {head?.name ?? "Workspace"}</span>
      </header>
      <WorkspaceGate key={teamId ?? ""} teamId={teamId} head={head} label={entry.contents}>
        {(ctx) => page === "inbox" ? <WorkspaceInbox {...ctx} />
          : page === "chat" ? <WorkspaceChat {...ctx} />
          : page === "call" ? <MemberCall key={ctx.teamId} target={{ teamId: ctx.teamId }} me={ctx.me} canJoin={ctx.canEdit} name={head?.name ?? "Workspace"} agent={headBot} open={() => openOriginPage("call")} />
          : <DrawingCanvas key={ctx.teamId} teamId={ctx.teamId} userId={ctx.me._id} name="Workspace drawing" readOnly={!ctx.canEdit} agent={headBot} />}
      </WorkspaceGate>
    </main>
  );
}

function useActiveCloudWorkspace(): { teamId: string | null; head?: { id: string; name: string } } {
  const { state } = useStore();
  const view = useWorkspaces();
  const { workspaces } = useCloudLinks();
  const headId = activeWorkspace(view, workspaceHeadsOf(state.bots));
  const head = state.bots.find((bot) => bot.id === headId);
  return { teamId: (headId && workspaces[headId]) || null, head: head && { id: head.id, name: head.name } };
}
