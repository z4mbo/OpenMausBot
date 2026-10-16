export type Release = { version: string; date: string; title: string; changes: { title: string; body: string }[] };

export const releases: Release[] = [{
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

export const latestRelease = releases[0];
export function releaseStorageKey(userId: string) { return `origin.release-seen.${userId}`; }

export function isReleaseHistory(value: unknown): value is Release[] {
  return Array.isArray(value) && value.length > 0 && value.every(release =>
    release && typeof release.version === "string" && typeof release.title === "string" &&
    typeof release.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(release.date) &&
    Array.isArray(release.changes) && release.changes.every((change: unknown) => Boolean(change && typeof change === "object" && "title" in change && typeof change.title === "string" && "body" in change && typeof change.body === "string")),
  );
}
