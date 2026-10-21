import { beforeEach, describe, expect, it, vi } from "vitest";

const daemon = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("../../server/browser-daemon.ts", () => ({ startBrowserDaemon: daemon.start }));

const { ownUiSessionDaemon } = await import("./control-omb-ui.ts");

describe("UI session daemon ownership", () => {
  beforeEach(() => { daemon.start.mockReset().mockResolvedValue({ pid: 12345 }); });

  it.each(["linux", "darwin"] as const)("keeps the normal CLI launch path on %s without starting a daemon subprocess", async (platform) => {
    daemon.start.mockRejectedValue(new Error("Unexpected subprocess"));
    await expect(ownUiSessionDaemon("unused-browser", { HOME: "synthetic-home" }, platform)).resolves.toBeUndefined();
    expect(daemon.start).not.toHaveBeenCalled();
  });

  it("starts the owned Windows daemon with the exact session environment", async () => {
    const env = { HOME: "synthetic-home", AGENT_BROWSER_SESSION: "synthetic-session" };
    await ownUiSessionDaemon("synthetic-browser", env, "win32");
    expect(daemon.start).toHaveBeenCalledExactlyOnceWith("synthetic-browser", env);
    expect(daemon.start.mock.calls[0][1]).toBe(env);
  });

  it("surfaces Windows daemon failure instead of continuing with an unowned daemon", async () => {
    daemon.start.mockRejectedValue(new Error("Synthetic daemon refusal"));
    await expect(ownUiSessionDaemon("synthetic-browser", {}, "win32")).rejects.toThrow("Synthetic daemon refusal");
    expect(daemon.start).toHaveBeenCalledTimes(1);
  });

  it("uses the actual host platform when no platform override is supplied", async () => {
    await ownUiSessionDaemon("synthetic-browser", {});
    expect(daemon.start).toHaveBeenCalledTimes(process.platform === "win32" ? 1 : 0);
  });
});
