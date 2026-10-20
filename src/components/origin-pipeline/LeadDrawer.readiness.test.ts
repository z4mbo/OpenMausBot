// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Bot } from "@/state/store";
import type { PipelineChannel } from "../../../shared/origin-pipeline";

vi.mock("@/lib/origin-cloud", () => ({
  cloudMutation: vi.fn(),
  useCloudQuery: (name: string) => name === "pipeline:lead" ? { lead: {
    _id: "lead", projectId: "project", name: "Synthetic lead", email: "lead@example.test", phone: "+12025550101",
    company: "Example", source: "Fixture", stage: "New", order: 1, tags: [], createdAt: 0, updatedAt: 0,
  }, activities: [] } : null,
}));
vi.mock("./pipeline-api", () => ({
  pipelineServer: { send: vi.fn(), refresh: vi.fn() }, rememberedCallerPhone: () => "+12025550102", rememberCallerPhone: vi.fn(),
}));

const { LeadDrawer } = await import("./LeadDrawer");
let root: Root | undefined;
let host: HTMLDivElement;
afterEach(() => { if (root) flushSync(() => root!.unmount()); root = undefined; host?.remove(); });

function show(channels: Record<PipelineChannel, boolean> | null) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  flushSync(() => root!.render(createElement(LeadDrawer, {
    projectId: "project", projectName: "Origin", leadId: "lead", stages: ["New"], currency: "USD", canEdit: true, owners: [],
    chief: { id: "chief", name: "Origin" } as Bot, channels,
    settings: { configured: true, captureEnabled: false, inboundEnabled: false, autoSend: false, currency: "USD", aiAgentId: "agent", aiPhoneNumberId: "number" },
    onClose() {}, onPlan() {}, onSequence() {},
  })));
}

function prepare(mode: string): HTMLButtonElement {
  const section = host.querySelector<HTMLElement>('section[aria-label="Reach out"]')!;
  const tab = [...section.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((item) => item.textContent === mode)!;
  flushSync(() => tab.click());
  for (const field of section.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input,textarea")) {
    const value = field.type === "tel" ? "+12025550102" : "Synthetic preview message";
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")!.set!.call(field, value);
    flushSync(() => field.dispatchEvent(new Event("input", { bubbles: true })));
  }
  return section.querySelector<HTMLButtonElement>('form button:not([type="button"])')!;
}

const connected = (email: boolean): Record<PipelineChannel, boolean> => ({ email, sms: true, whatsapp: true, call: true, ai_call: true });

describe("Pipeline outreach connections", () => {
  it.each(["Email", "Text", "WhatsApp", "Call", "AI call"])("blocks %s while connection status is unknown", (mode) => {
    show(null);
    expect(prepare(mode).disabled).toBe(true);
    expect(host.textContent).toContain("Connections are not confirmed on this computer");
  });

  it("keeps local notes available while connection status is unknown", () => {
    show(null);
    expect(prepare("Note").disabled).toBe(false);
  });

  it("keeps known disconnected email unavailable and explains how to connect it", () => {
    show(connected(false));
    expect(prepare("Email").disabled).toBe(true);
    expect(host.textContent).toContain("Connect Brevo");
  });

  it("allows a complete email when the connection is confirmed", () => {
    show(connected(true));
    expect(prepare("Email").disabled).toBe(false);
  });
});
