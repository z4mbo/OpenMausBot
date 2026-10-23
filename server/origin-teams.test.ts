import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { retireDefaultAgents } from "./origin-teams.ts";
import { Store } from "./store.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "fixture" });
const DEVELOPER = { name: "Developer", title: "Developer", soul: "You build and fix the product's code, test what you change, and report what shipped." };
const DESIGNER = { name: "Designer", title: "Designer", soul: "You design the product's flows, screens and visual identity, and explain the reasoning behind them." };

describe("default project agents", () => {
  beforeEach(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

  it("deletes untouched ones, archives ones with a conversation and keeps edited or unrelated agents", () => {
    const store = new Store(selection);
    const chief = store.createBot({ name: "Kai", section: "Kai" });
    store.setChiefOfStaff(chief.id);
    const idle = store.createBot({ ...DEVELOPER, section: "Kai" });
    const talked = store.createBot({ ...DESIGNER, section: "Kai" });
    store.appendMessage(talked.threadId, { role: "user", kind: "text", text: "Draw the logo" });
    const edited = store.createBot({ ...DEVELOPER, soul: "You only write Rust.", section: "Kai" });
    const elsewhere = store.createBot({ ...DEVELOPER, section: "Loose team" });

    expect(retireDefaultAgents(store)).toBe(2);
    expect(store.bot(idle.id)).toBeNull();
    expect(store.bot(talked.id)?.hidden).toBe(true);
    expect(store.bot(edited.id)?.hidden).toBeFalsy();
    expect(store.bot(elsewhere.id)?.hidden).toBeFalsy();
    expect(store.bot(chief.id)).not.toBeNull();
    expect(retireDefaultAgents(store)).toBe(0);
  });
});
