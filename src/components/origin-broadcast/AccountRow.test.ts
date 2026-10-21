// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BROADCAST_CHANNELS, type BroadcastAccount } from "../../../shared/broadcast";
import { AccountRow } from "./ComposerParts";
import type { ChannelAccounts } from "./use-broadcast-accounts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const available: BroadcastAccount[] = [
  { id: "default", integration: "x", channels: ["x"], label: "@default", isDefault: true, projectIds: null, source: "yours" },
  { id: "extra", integration: "x", channels: ["x"], label: "@extra", isDefault: false, projectIds: null, source: "yours" },
];
const accounts = (count: number): ChannelAccounts => Object.fromEntries(BROADCAST_CHANNELS.map((channel) => [channel, channel === "x" ? available.slice(0, count) : []])) as ChannelAccounts;

function render(count: number, chosen: string | undefined, locked = false) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(AccountRow, {
    channels: ["x"], accounts: accounts(count), chosen: { x: chosen }, locked, onChoose() {}, onConnect() {},
  }));
  return host;
}

describe("Publish account identity", () => {
  it.each([1, 2])("shows an unselected placeholder for a removed explicit account with %i available accounts", (count) => {
    const select = render(count, "removed").querySelector("select");
    expect(select).not.toBeNull();
    expect(select!.value).toBe("");
    expect(select!.selectedOptions[0].textContent).toBe("Choose an account");
    expect(select!.selectedOptions[0].disabled).toBe(true);
  });

  it.each([1, 2])("allows an explicit replacement from %i available accounts", (count) => {
    const onChoose = vi.fn();
    function ChoiceRow() {
      const [chosen, setChosen] = useState("removed");
      return createElement(AccountRow, {
        channels: ["x"], accounts: accounts(count), chosen: { x: chosen }, locked: false, onConnect() {},
        onChoose(channel, accountId) { onChoose(channel, accountId); setChosen(accountId); },
      });
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      act(() => root.render(createElement(ChoiceRow)));
      const select = host.querySelector("select");
      expect(select).not.toBeNull();
      expect(select!.value).toBe("");
      expect(onChoose).not.toHaveBeenCalled();
      const target = available[count - 1];
      act(() => { select!.value = target.id; select!.dispatchEvent(new Event("change", { bubbles: true })); });
      expect(onChoose).toHaveBeenCalledExactlyOnceWith("x", target.id);
      expect(host.textContent).not.toContain("Choose an account");
      if (count === 1) expect(host.textContent).toContain(target.label);
      else expect(host.querySelector("select")!.value).toBe(target.id);
    } finally { act(() => root.unmount()); }
  });

  it.each([1, 2])("keeps the first account as the default only when no explicit identity was saved (%i accounts)", (count) => {
    const host = render(count, undefined);
    expect(host.textContent).not.toContain("Choose an account");
    if (count === 1) expect(host.textContent).toContain("@default");
    else expect(host.querySelector("select")!.value).toBe("default");
  });

  it("preserves a valid extra account selection", () => {
    expect(render(2, "extra").querySelector("select")!.value).toBe("extra");
  });

  it("keeps an unresolved account choice disabled while editing is locked", () => {
    const select = render(1, "removed", true).querySelector("select");
    expect(select).not.toBeNull();
    expect(select!.disabled).toBe(true);
    expect(select!.value).toBe("");
  });
});
