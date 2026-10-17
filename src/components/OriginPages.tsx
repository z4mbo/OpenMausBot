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
import { lazyScreen } from "./lazy-screens";
import { useBotColor } from "@/lib/origin-avatar-looks";
import { accentVars } from "@/lib/user-bubble-tone";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/excalidraw-assets";

const DrawingCanvas = lazyScreen("DrawingCanvas", async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
  return (await import("./origin-pages/DrawingCanvas")).DrawingCanvas;
});

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
  return (
    <nav aria-label="Workspace" data-origin-nav className={cn("flex flex-col gap-0.5", iconsOnly ? "items-center py-1" : "pb-1 pt-1.5")}>
      {ORIGIN_PAGES.map(({ id, label, icon: Icon }) => {
        const active = open === id;
        return (
          <button key={id} type="button" aria-current={active ? "page" : undefined} title={iconsOnly ? label : undefined} aria-label={iconsOnly ? label : undefined}
            data-origin-nav-item={id} onClick={() => openOriginPage(id)}
            className={cn("flex items-center rounded-xl outline-none transition-colors focus-visible:ring-1 focus-visible:ring-accent/60",
              iconsOnly ? "size-[46px] justify-center" : cn("w-full py-1 pr-3 text-left", lead.padding, lead.gap),
              active ? "bg-raised text-ink" : "text-ink hover:bg-raised/50")}>
            <span className="flex shrink-0 items-center justify-center" style={iconsOnly ? undefined : { width: lead.size, height: Math.min(lead.size, 32) }}>
              <Icon size={20} className={active ? "text-accent" : "text-ink-secondary"} aria-hidden="true" />
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
  const accent = accentVars(useBotColor(state.bots.find((bot) => bot.id === head?.id)));
  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app" data-origin-page={page} style={accent}>
      <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-hairline/40 px-4 pl-11 md:pl-5">
        <Icon size={20} className="text-ink-secondary" aria-hidden="true" />
        <h1 className="text-[15px] font-semibold text-ink">{entry.label}</h1>
      </header>
      <WorkspaceGate key={teamId ?? ""} teamId={teamId} head={head} label={entry.contents}>
        {(ctx) => page === "inbox" ? <WorkspaceInbox {...ctx} />
          : page === "chat" ? <WorkspaceChat {...ctx} />
          : page === "call" ? <MemberCall key={ctx.teamId} target={{ teamId: ctx.teamId }} me={ctx.me} canJoin={ctx.canEdit} name="Workspace" emptyNote="Nobody is in the workspace call yet" />
          : <DrawingCanvas key={ctx.teamId} teamId={ctx.teamId} userId={ctx.me._id} name="Workspace drawing" readOnly={!ctx.canEdit} />}
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
