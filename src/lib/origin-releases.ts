import { releases } from "../../shared/origin-releases";

export { releases, type Release, type ReleaseChange } from "../../shared/origin-releases";

export const WHATS_NEW_SEEN_KEY = "origin-whats-new-seen";

export const latestRelease = releases[0]!;

export function hasUnseenRelease(seenDate: string | null): boolean {
  return !seenDate || latestRelease.date > seenDate;
}

export function releaseDateLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}
