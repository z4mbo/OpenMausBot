import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { glassPopupTopInset } from "./glass-popup";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(src, "styles.css"), "utf8");

function rule(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  return css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
}

function skinBlocks(): string[] {
  return [...css.matchAll(/\[data-skin="[a-z]+"\] \{[\s\S]*?\n\}/g)].map((match) => match[0]);
}

describe("popup frame", () => {
  it("lives outside every skin block, and every skin still defines the tokens it reads", () => {
    const blocks = skinBlocks();
    expect(blocks).toHaveLength(9);
    for (const block of blocks) {
      expect(block).not.toContain("glass");
      for (const token of ["--color-menu", "--color-card", "--color-ink"]) expect(block).toContain(`${token}:`);
    }
  });

  it("sits in a safe area clear of the window's own buttons, at every window size", () => {
    const frame = rule(".glass-popup-frame");
    expect(frame).toContain("position: fixed");
    expect(frame).toContain("padding: var(--glass-popup-top, 24px) 24px 24px");
    const pane = rule(".glass-popup");
    expect(pane).toContain("width: min(1040px, 100%)");
    expect(pane).toContain("height: min(760px, 100%)");
    expect(glassPopupTopInset("mac-inset")).toBe(56);
    expect(glassPopupTopInset("win-caption")).toBe(56);
    expect(glassPopupTopInset("native")).toBe(24);
    for (const file of ["SettingsModal.tsx", "PluginsPanel.tsx", "TriggersPanel.tsx"]) {
      const source = readFileSync(join(src, "components", file), "utf8");
      expect(source, file).toContain('className="glass-popup-frame"');
      expect(source, file).toContain("style={glassPopupFrameStyle()}");
      expect(source, file).not.toMatch(/100dvh/);
    }
  });

  it("lets the Apps contents reflow inside the pop-up rather than overflow it", () => {
    const apps = readFileSync(join(src, "components", "PluginsPanel.tsx"), "utf8");
    expect(apps).toContain('data-apps-grid className="@container flex flex-col gap-7 pt-1"');
    expect(apps).toContain("grid grid-cols-1 items-start gap-x-6 gap-y-1 @xl:grid-cols-2");
    const mcp = readFileSync(join(src, "components", "McpServersPanel.tsx"), "utf8");
    expect(mcp).toContain('data-mcp-row className="flex flex-wrap items-center gap-3"');
    expect(mcp).toContain('data-mcp-row-actions className="ml-auto flex flex-wrap items-center justify-end gap-1"');
  });
});
