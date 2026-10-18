import { describe, expect, it } from "vitest";
import { HEADLESS_USAGE, USAGE } from "./cli-usage.ts";
import { VERB_HELP } from "./headless/main.ts";
import { unstableInstallWarning } from "./service-unit.ts";

describe("Origin checkout instructions", () => {
  it("starts from the Origin checkout without installing the upstream application", () => {
    expect(USAGE).toContain("https://github.com/z4mbo/Origin");
    expect(USAGE).toContain("pnpm install --frozen-lockfile");
    expect(USAGE).toContain("pnpm omb setup");
    expect(USAGE).toContain("pnpm pair");
    expect(USAGE).not.toMatch(/(?:npm install -g|npx) openmausbot/);
  });

  it("runs every headless help example from the checkout", () => {
    expect(HEADLESS_USAGE).toContain("pnpm omb doctor");
    for (const help of Object.values(VERB_HELP)) expect(help).toMatch(/^pnpm omb /);
  });

  it("recovers from a disposable npm cache by using a stable Origin checkout", () => {
    const warning = unstableInstallWarning("/home/user/.npm/_npx/fixture/node_modules/openmausbot/cli.js");
    expect(warning).toContain("Origin checkout");
    expect(warning).toContain("pnpm omb service install");
    expect(warning).not.toContain("npm install -g openmausbot");
  });
});
