import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { browserDaemonFile } from "../../server/browser-engine.ts";
import { sessionEnv } from "./control-omb-ui.ts";

it("keeps native daemon discovery inside the selected fixture", () => {
  const home = join(tmpdir(), "omb-ui-isolated-session");
  const session = "omb-ui-9100";
  const env = sessionEnv({ home, session, chrome: null }, {
    HOME: "/personal/home",
    USERPROFILE: "/personal/profile",
    XDG_RUNTIME_DIR: "/personal/runtime",
    AGENT_BROWSER_SOCKET_DIR: "/personal/sockets",
  });
  expect(browserDaemonFile(env, ".stream")).toBe(join(home, "runtime", "agent-browser", `${session}.stream`));
  expect(env).not.toHaveProperty("AGENT_BROWSER_SOCKET_DIR");
});
