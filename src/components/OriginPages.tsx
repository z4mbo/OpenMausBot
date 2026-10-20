import { Brush, Headset, Inbox, MessageCircle, Network } from "lucide-react";
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
import { OrgPage } from "./origin-org/OrgPage";
import { WorkspaceGate } from "./origin-pages/ui";
import { DrawingCanvas } from "./OriginDraw";
import { GlassHeaderFrame } from "./GlassScrollFrame";
import { useBotColor } from "@/lib/origin-avatar-looks";
import { useOriginInboxAlerts } from "@/lib/origin-inbox-alerts";
import { accentVars } from "@/lib/user-bubble-tone";

export const ORIGIN_PAGES: { id: OriginPage; label: string; contents: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", contents: "Issues and notifications", icon: Inbox },
  { id: "chat", label: "Chat", contents: "Messages", icon: MessageCircle },
  { id: "call", label: "Call", contents: "Calls", icon: Headset },
  { id: "draw", label: "Canvas", contents: "Canvases", icon: Brush },
  { id: "org", label: "Org", contents: "The boss, Chiefs and agents", icon: Network },
];

export function OriginNav({ density }: { density: SidebarDensity }) {
  const open = useOriginPage();
  const lead = sidebarRowLead(density, useShowThreads());
  const iconsOnly = density === "icons";
  const { state } = useStore();
  const { teamId, head } = useActiveCloudWorkspace();
  const accent = accentVars(useBotColor(state.bots.find((bot) => bot.id === head?.id)));
  const inbox = useOriginInboxAlerts(teamId);
  const inboxCount = inbox.unread > 0 ? `${inbox.unread}${inbox.more ? "+" : ""}` : "";
  return (
    <nav aria-label="Workspace" data-origin-nav style={accent} className={cn("flex flex-col gap-0.5", iconsOnly ? "items-center py-1" : "pb-1 pt-1.5")}>
      {ORIGIN_PAGES.map(({ id, label, icon: Icon }) => {
        const active = open === id;
        const count = id === "inbox" ? inboxCount : "";
        const name = count ? `${label}, ${count} unread` : label;
        return (
          <button key={id} type="button" aria-current={active ? "page" : undefined} title={iconsOnly ? name : undefined} aria-label={iconsOnly || count ? name : undefined}
            data-origin-nav-item={id} onClick={() => openOriginPage(id)}
            className={cn("group flex items-center rounded-xl outline-none transition-[background-color,transform] duration-(--motion-fast) active:scale-[0.98] focus-visible:ring-1 focus-visible:ring-accent/60 motion-reduce:active:scale-100",
              iconsOnly ? "size-[46px] justify-center" : cn("w-full py-1 pr-3 text-left", lead.padding, lead.gap),
              active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50")}>
            <span className="relative flex shrink-0 items-center justify-center" style={iconsOnly ? undefined : { width: lead.size, height: Math.min(lead.size, 32) }}>
              <Icon size={20} aria-hidden="true" className={cn("transition-colors duration-(--motion-fast) motion-reduce:transition-none", active ? "text-ink" : "text-ink-secondary group-hover:text-ink")} />
              {count && iconsOnly && <span aria-hidden="true" className="absolute -right-1 -top-1 size-2.5 rounded-full bg-accent ring-2 ring-app" />}
            </span>
            {!iconsOnly && <span className="flex-1 truncate text-[14px] font-medium leading-5">{label}</span>}
            {count && !iconsOnly && <span aria-hidden="true" data-origin-inbox-unread className="rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-[18px] text-accent-ink">{count}</span>}
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
      <GlassHeaderFrame className="flex min-h-0 flex-1 flex-col [--glass-tint:var(--color-app)]" barClassName="z-[25]" bar={
        <header className="flex h-14 shrink-0 items-center gap-2.5 px-4 pl-11 md:pl-5">
          <span key={page} className="flex size-8 items-center justify-center rounded-xl bg-raised text-ink-secondary"><Icon size={18} aria-hidden="true" /></span>
          <h1 key={`${page}-title`} className="text-[15px] font-semibold text-ink origin-rise">{entry.label}</h1>
          <span className="hidden truncate text-[12.5px] text-ink-tertiary sm:inline">· {head?.name ?? "Workspace"}</span>
        </header>
      }>
        <WorkspaceGate key={teamId ?? ""} teamId={teamId} head={head} label={entry.contents}>
          {(ctx) => page === "inbox" ? <WorkspaceInbox {...ctx} />
            : page === "chat" ? <WorkspaceChat {...ctx} />
            : page === "org" ? <OrgPage {...ctx} />
            : page === "call" ? <MemberCall key={ctx.teamId} target={{ teamId: ctx.teamId }} me={ctx.me} canJoin={ctx.canEdit} name={head?.name ?? "Workspace"} agent={headBot} open={() => openOriginPage("call")} />
            : <div className="flex min-h-0 flex-1 flex-col pt-[var(--glass-top,0px)]"><DrawingCanvas key={ctx.teamId} teamId={ctx.teamId} userId={ctx.me._id} name="Workspace drawing" readOnly={!ctx.canEdit} agent={headBot} /></div>}
        </WorkspaceGate>
      </GlassHeaderFrame>
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
