import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const cloud = vi.hoisted(() => ({ url: "https://example.convex.cloud" as string | null, signedIn: false }));

vi.mock("@/lib/origin-cloud", () => ({
  useCloudUrl: () => cloud.url,
  useCloudSession: () => ({
    user: cloud.signedIn ? { _id: "u1", email: "a@example.com" } : null,
    token: cloud.signedIn ? "t" : null,
    ready: true,
    login: async () => {},
    logout: async () => {},
  }),
  useCloudQuery: () => undefined,
  cloudMutation: async () => undefined,
  cloudAction: async () => undefined,
}));

const pages = await import("./index");
const all: [string, ComponentType<{ cloudProjectId: string | null; projectName: string }>][] = [
  ["Issues", pages.IssuesPage], ["Assets", pages.AssetsPage], ["Vault", pages.VaultPage],
  ["Repo", pages.RepoPage], ["Feedback", pages.FeedbackPage], ["Settings", pages.ProjectSettingsPage],
];
const render = (Page: ComponentType<{ cloudProjectId: string | null; projectName: string }>, cloudProjectId: string | null) =>
  renderToStaticMarkup(createElement(Page, { cloudProjectId, projectName: "Demo" }));

describe("origin pages", () => {
  it.each(all)("%s asks to connect a project that has no cloud id", (_name, Page) => {
    cloud.signedIn = true;
    expect(render(Page, null)).toContain("Connect this project to Origin");
  });

  it.each(all)("%s asks to sign in without a session", (_name, Page) => {
    cloud.signedIn = false;
    expect(render(Page, "p1")).toContain("Sign in to Origin");
  });

  it.each(all)("%s shows a loading state while the project loads", (_name, Page) => {
    cloud.signedIn = true;
    expect(render(Page, "p1")).toContain('role="status"');
  });
});
