import { Inbox, MessagesSquare, PenTool, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { openOriginPage, useOriginPage, type OriginPage } from "@/lib/origin-pages";
import { useCloudLinks } from "@/lib/origin-cloud-links";
import { activeWorkspace, useWorkspaces, workspaceHeadsOf } from "@/lib/origin-workspaces";
import { useStore } from "@/state/store";
import { MemberCall } from "./origin-pages/CallPage";
import { WorkspaceChat } from "./origin-pages/WorkspaceChatPage";
import { WorkspaceInbox } from "./origin-pages/WorkspaceInboxPage";
import { WorkspaceGate } from "./origin-pages/ui";
import { lazyScreen } from "./lazy-screens";
import { EXCALIDRAW_ASSET_PATH } from "@/lib/excalidraw-assets";

const DrawingCanvas = lazyScreen("DrawingCanvas", async () => {
  (window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
  return (await import("./origin-pages/DrawingCanvas")).DrawingCanvas;
});

export const ORIGIN_PAGES: { id: OriginPage; label: string; contents: string; icon: typeof Inbox }[] = [
  { id: "inbox", label: "Inbox", contents: "Issues and notifications", icon: Inbox },
  { id: "chat", label: "Chat", contents: "Messages", icon: MessagesSquare },
  { id: "call", label: "Call", contents: "Calls", icon: Phone },
  { id: "draw", label: "Draw", contents: "Drawings", icon: PenTool },
];

export function OriginNav({ iconsOnly = false }: { iconsOnly?: boolean }) {
  const open = useOriginPage();
  return (
    <nav aria-label="Workspace" data-origin-nav className={cn("flex flex-col gap-0.5", iconsOnly ? "items-center py-1" : "pt-1")}>
      {ORIGIN_PAGES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-current={open === id ? "page" : undefined} title={label} aria-label={label}
          onClick={() => openOriginPage(id)}
          className={cn("flex items-center rounded-lg text-ink-secondary hover:bg-raised/60 hover:text-ink",
            iconsOnly ? "size-[46px] justify-center rounded-xl" : "gap-[6px] px-1 py-1.5 text-[13.5px]",
            open === id && "bg-raised text-ink")}>
          <Icon size={iconsOnly ? 18 : 14} className="shrink-0" aria-hidden="true" />{!iconsOnly && label}
        </button>
      ))}
    </nav>
  );
}

export function OriginPageView({ page }: { page: OriginPage }) {
  const entry = ORIGIN_PAGES.find((item) => item.id === page)!;
  const Icon = entry.icon;
  const teamId = useActiveCloudWorkspace();
  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col bg-app" data-origin-page={page}>
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline/40 px-4 py-2.5 pl-11 md:pl-4">
        <Icon size={15} className="text-ink-secondary" aria-hidden="true" />
        <h1 className="text-[14px] font-semibold text-ink">{entry.label}</h1>
      </header>
      <WorkspaceGate key={teamId ?? ""} teamId={teamId} label={entry.contents}>
        {(ctx) => page === "inbox" ? <WorkspaceInbox {...ctx} />
          : page === "chat" ? <WorkspaceChat {...ctx} />
          : page === "call" ? <MemberCall key={ctx.teamId} target={{ teamId: ctx.teamId }} me={ctx.me} canJoin={ctx.canEdit} name="Workspace" emptyNote="Nobody is in the workspace call yet" />
          : <DrawingCanvas key={ctx.teamId} teamId={ctx.teamId} userId={ctx.me._id} name="Workspace drawing" readOnly={!ctx.canEdit} />}
      </WorkspaceGate>
    </main>
  );
}

function useActiveCloudWorkspace(): string | null {
  const { state } = useStore();
  const view = useWorkspaces();
  const { workspaces } = useCloudLinks();
  const headId = activeWorkspace(view, workspaceHeadsOf(state.bots));
  return (headId && workspaces[headId]) || null;
}
