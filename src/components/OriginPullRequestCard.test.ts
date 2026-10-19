// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@/state/store";
import type { OriginPullRequestCard as Card } from "../../shared/origin-pull-request";

const review = vi.fn();
vi.mock("@/lib/origin-github", () => ({ originGitHub: { review: (...args: unknown[]) => review(...args) } }));
vi.mock("@/lib/app-links", () => ({ openExternalLink: vi.fn() }));

const { OriginPullRequestCard, mergeConfirmation } = await import("./OriginPullRequestCard");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const card = (fields: Partial<Card> = {}): Card => ({
  projectId: "p1", projectName: "Kai", number: 7, title: "Add the login page", url: "https://github.com/k/k/pull/7", state: "open",
  branch: "origin/ORI-AB12-login", baseBranch: "main", headSha: "a".repeat(40), additions: 120, deletions: 8, files: 4,
  checks: "success", review: "approved", mergeable: true, closes: ["ORI-AB12"], ...fields,
});
const message = (pr: Card): Message => ({ id: "m1", role: "bot", kind: "activity", at: 1, tool: { name: "origin_review_pr", ok: true }, originPullRequest: pr } as Message);

let host: HTMLDivElement;
let root: Root;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); review.mockReset(); });
afterEach(() => { act(() => root.unmount()); host.remove(); });

const button = (name: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === name);

describe("OriginPullRequestCard", () => {
  it("shows size, checks, review and the issues it closes", () => {
    act(() => root.render(createElement(OriginPullRequestCard, { message: message(card()) })));
    expect(host.textContent).toContain("Add the login page");
    expect(host.textContent).toContain("+120 −8 · 4 files");
    expect(host.textContent).toContain("Checks passed");
    expect(host.textContent).toContain("Approved");
    expect(host.textContent).toContain("Closes ORI-AB12");
  });

  it("merges only after the person confirms, pinned to the head the Chief read", async () => {
    review.mockResolvedValue({ approved: true, merged: true, sha: "c".repeat(40) });
    act(() => root.render(createElement(OriginPullRequestCard, { message: message(card()) })));
    act(() => button("Approve & merge")!.click());
    expect(review).not.toHaveBeenCalled();
    expect(host.textContent).toContain(mergeConfirmation(card()));
    act(() => button("Cancel")!.click());
    expect(button("Approve & merge")).toBeTruthy();
    act(() => button("Approve & merge")!.click());
    await act(async () => { button("Merge")!.click(); });
    expect(review.mock.calls).toEqual([
      ["p1", 7, "approve", "Approved in Origin."],
      ["p1", 7, "merge", undefined, "a".repeat(40)],
    ]);
    expect(host.textContent).toContain("Merged (ccccccc)");
  });

  it("says why it cannot merge and offers no merge button", () => {
    act(() => root.render(createElement(OriginPullRequestCard, { message: message(card({ checks: "failure", blocker: "checks on #7 are failure; merge once they pass" })) })));
    expect(host.textContent).toContain("Not mergeable now: checks on #7 are failure");
    expect(button("Approve & merge")).toBeUndefined();
  });

  it("shows a refused merge and lets the person try again", async () => {
    review.mockResolvedValueOnce({ approved: true }).mockRejectedValueOnce(new Error("A project admin approves and merges pull requests"));
    act(() => root.render(createElement(OriginPullRequestCard, { message: message(card()) })));
    act(() => button("Approve & merge")!.click());
    await act(async () => { button("Merge")!.click(); });
    expect(host.textContent).toContain("A project admin approves and merges pull requests");
    expect(button("Approve & merge")).toBeTruthy();
  });
});
