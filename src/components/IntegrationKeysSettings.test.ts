// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IntegrationStatus, SharedIntegration } from "../../shared/integration-keys";
import { IntegrationKeyList } from "./IntegrationKeysSettings";

const fixture = vi.hoisted(() => ({
  role: "member" as string,
  integrations: [] as unknown[],
  api: vi.fn(),
}));
vi.mock("@/state/store", () => ({ api: fixture.api }));
vi.mock("@/lib/origin-members", () => ({ useWorkspaceAccess: () => ({ teamId: "team1", slug: "acme", role: fixture.role }) }));
vi.mock("@/lib/origin-cloud/client", () => ({ sessionStore: { get: () => "synthetic-session" } }));
vi.mock("@/lib/origin-project-state", () => ({
  useOriginProjects: (teamId: string | null) => ({ rows: teamId ? [{ _id: "p1", teamId: "team1", name: "Launch", status: "active", memberRole: "member" }, { _id: "p2", teamId: "team1", name: "Site", status: "active", memberRole: "admin" }] : undefined, status: new Map() }),
  canManageProject: (row: { memberRole?: string } | undefined) => row?.memberRole === "owner" || row?.memberRole === "admin",
}));
vi.mock("@/lib/use-origin-workspace", () => ({ useActiveOriginWorkspace: () => ({ teamId: "team1" }) }));
vi.mock("./origin-members/WorkspaceGitHubCard", () => ({ WorkspaceGitHubCard: () => null }));

const launch: SharedIntegration = { by: "Ada", projectId: "p1", projectName: "Launch" };
const fal = (patch: Partial<IntegrationStatus>): IntegrationStatus => ({
  id: "fal", label: "fal.ai", help: "https://fal.ai/dashboard/keys", configured: false, source: null, shared: null, shares: [],
  fields: [{ name: "key", label: "API key", secret: true, optional: false, set: false }], ...patch,
});

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  fixture.role = "member";
  fixture.api.mockReset();
  fixture.api.mockImplementation(async (path: string) => (path.startsWith("/api/integrations?") ? { integrations: fixture.integrations } : {}));
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const render = async (project?: { id: string; name: string; canManage: boolean }) =>
  act(async () => root.render(createElement(IntegrationKeyList, { teamId: "team1", ...(project ? { project } : {}) })));
const open = async () => act(async () => host.querySelector<HTMLButtonElement>('[data-integration="fal"] button[aria-expanded]')!.click());
const button = (text: string) => [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === text);

describe("integration keys shared with one project", () => {
  it("tells a member a key is shared for one project only, with nothing to manage", async () => {
    fixture.integrations = [fal({ shares: [launch] })];
    await render();
    expect(fixture.api).toHaveBeenCalledWith("/api/integrations?teamId=team1");
    expect(host.textContent).toContain("Shared for Launch only");
    await open();
    expect(host.textContent).toContain("Shared by Ada with Launch only; other projects don't get it");
    expect(button("Stop sharing")).toBeUndefined();
    expect(host.querySelector("select")).toBeNull();
  });

  it("lets an admin share their own key with one project and stop sharing it", async () => {
    fixture.role = "admin";
    fixture.integrations = [fal({ configured: true, source: "yours", fields: [{ name: "key", label: "API key", secret: true, optional: false, set: true }] })];
    await render();
    await open();
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Share fal.ai with"]')!;
    expect([...select.options].map((option) => option.textContent)).toEqual(["The whole workspace", "Only Launch", "Only Site"]);
    fixture.integrations = [fal({ configured: true, source: "yours", shares: [launch], fields: [{ name: "key", label: "API key", secret: true, optional: false, set: true }] })];
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "p1");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => button("Share")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/integrations/fal/share?teamId=team1&projectId=p1", expect.objectContaining({ method: "POST" }));
    expect(host.textContent).toContain("Yours · shared");
    expect(button("Share again")).toBeDefined();
    vi.stubGlobal("confirm", () => true);
    await act(async () => button("Stop sharing")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/integrations/fal/share?teamId=team1&projectId=p1", expect.objectContaining({ method: "DELETE" }));
  });

  it("reads a project's keys with its id and offers a project admin that project alone", async () => {
    fixture.integrations = [fal({ configured: true, source: "yours", fields: [{ name: "key", label: "API key", secret: true, optional: false, set: true }] })];
    await render({ id: "p2", name: "Site", canManage: true });
    expect(fixture.api).toHaveBeenCalledWith("/api/integrations?teamId=team1&projectId=p2");
    await open();
    expect(host.querySelector("select")).toBeNull();
    await act(async () => button("Share with Site")!.click());
    expect(fixture.api).toHaveBeenCalledWith("/api/integrations/fal/share?teamId=team1&projectId=p2", expect.objectContaining({ method: "POST" }));
  });

  it("shows a member in a project the key shared with that project", async () => {
    fixture.integrations = [fal({ configured: true, source: "shared", shared: launch, shares: [launch, { by: "Bo", projectId: "p9", projectName: "Other" }] })];
    await render({ id: "p1", name: "Launch", canManage: false });
    expect(host.textContent).toContain("Shared by Ada for Launch only");
    await open();
    expect(host.textContent).toContain("use it in Launch until you add a key of your own");
    expect(host.textContent).not.toContain("Other");
  });
});
