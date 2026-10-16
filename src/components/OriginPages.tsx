import { Inbox, MessagesSquare, PenTool, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { openOriginPage, useOriginPage, type OriginPage } from "@/lib/origin-pages";

export const ORIGIN_PAGES: { id: OriginPage; label: string; icon: typeof Inbox; blurb: string }[] = [
  { id: "inbox", label: "Inbox", icon: Inbox, blurb: "Everything that needs you across the workspace: mentions, approvals and updates." },
  { id: "chat", label: "Chat", icon: MessagesSquare, blurb: "Talk with the people in this workspace, in channels and direct messages." },
  { id: "call", label: "Call", icon: Phone, blurb: "Voice and video calls with your team, with agents joining when you need them." },
  { id: "draw", label: "Draw", icon: PenTool, blurb: "A shared canvas for sketches, flows and plans." },
];

export function OriginNav({ iconsOnly = false }: { iconsOnly?: boolean }) {
  const open = useOriginPage();
  return (
    <nav aria-label="Workspace" data-origin-nav className={cn("flex flex-col gap-0.5", iconsOnly ? "items-center py-1" : "pt-1")}>
      {ORIGIN_PAGES.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" aria-current={open === id ? "page" : undefined} title={label} aria-label={label}
          onClick={() => openOriginPage(id)}
          className={cn("flex items-center rounded-lg text-ink-secondary hover:bg-raised/60 hover:text-ink",
            iconsOnly ? "size-[46px] justify-center rounded-xl" : "gap-2.5 px-2.5 py-1.5 text-[13.5px]",
            open === id && "bg-raised text-ink")}>
          <Icon size={iconsOnly ? 18 : 16} aria-hidden="true" />{!iconsOnly && label}
        </button>
      ))}
    </nav>
  );
}

export function OriginPageView({ page }: { page: OriginPage }) {
  const entry = ORIGIN_PAGES.find((item) => item.id === page)!;
  const Icon = entry.icon;
  return (
    <main className="relative flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-app p-6 text-center">
      <Icon size={30} className="text-ink-secondary" aria-hidden="true" />
      <h1 className="text-[18px] font-semibold text-ink">{entry.label}</h1>
      <p className="max-w-sm text-[13px] text-ink-secondary">{entry.blurb}</p>
      <span className="rounded-full bg-raised px-3 py-1 text-[12px] text-ink-secondary">Coming soon</span>
    </main>
  );
}
