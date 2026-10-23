import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";

vi.mock("@/components/Avatar", () => ({ BotAvatar: () => null }));
import { CalendarSidebar } from "./CalendarSidebar";

const bot = (id: string, extra: Partial<Bot>) => ({ id, name: id, title: "", description: "", ...extra }) as Bot;

describe("Routines bot list", () => {
  it("shows each bot's role, or its project or team, never a placeholder", () => {
    const html = renderToStaticMarkup(createElement(CalendarSidebar, {
      anchor: Date.parse("2026-10-23T12:00:00Z"), onSelectDate: vi.fn(),
      bots: [bot("Nova", { title: "Developer", section: "Walkies" }), bot("Atlas", { section: "Walkies", chiefOfStaff: true }), bot("Loose", {})],
    }));
    expect(html).toContain(">Developer<");
    expect(html).toContain(">Walkies<");
    expect(html).not.toContain("BotAgent");
  });
});
