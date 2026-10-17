export type ReleaseChange = { title: string; body: string };
export type Release = { version: string; date: string; title: string; changes: ReleaseChange[] };

export const WHATS_NEW_SEEN_KEY = "origin-whats-new-seen";

export const releases: Release[] = [{
  version: "desktop-1.0",
  date: "2026-10-16",
  title: "Origin on the desktop",
  changes: [
    { title: "Projects with default agents", body: "Every project starts with its own team of agents, ready to pick up work the moment you create it. Reorder them, add your own or start from a template team." },
    { title: "Workspaces", body: "Keep separate workspaces for separate parts of your life or business, and switch between them from the top of the sidebar." },
    { title: "Zap Liquid avatars", body: "Give each agent a Zap face in the Minimal or Liquid glass style, with its own colours, mascot shape and gaze." },
    { title: "Inbox, Chat, Call and Draw", body: "One Inbox for what needs you, chat with any agent, call it live by voice, or sketch together on a shared canvas." },
  ],
}, {
  version: "1.0",
  date: "2026-09-27",
  title: "A sharper workspace",
  changes: [
    { title: "Keyboard first", body: "C creates an issue. F, / or Cmd/Ctrl + K opens search. Enter opens the best match; arrow keys choose another result. In chat, typing returns to your message." },
    { title: "A cleaner issue editor", body: "Create issues from one compact row. Choose a project when starting outside a project, and select a priority explicitly. Searchable menus and mobile-sized date controls keep everything consistent." },
    { title: "A calmer sidebar", body: "Refined spacing, rounded-square avatars and a resizable sidebar. Your avatar moves with the project selection. Drag the sidebar edge left to collapse it, then use the top-left button to keep it open again." },
    { title: "One Inbox, two views", body: "Issues and notifications share the Inbox; empty notifications stay collapsed. Switch between List and Calendar beside Active and Completed, keeping your project and priority filters. Issue rows stay borderless until you hover." },
    { title: "Small details, fixed", body: "No extra borders while typing, no background flash in issue descriptions, and no leftover project highlight when collapsing the project list." },
  ],
}];

export const latestRelease = releases[0]!;

export function hasUnseenRelease(seenDate: string | null): boolean {
  return !seenDate || latestRelease.date > seenDate;
}

export function releaseDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
