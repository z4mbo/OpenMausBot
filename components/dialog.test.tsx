// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Dialog } from "./dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.innerHTML = ""; });

function Harness({ keep = false }: { keep?: boolean }) {
  const [open, setOpen] = useState(false);
  return <main>
    <h1>Board</h1>
    <button id="opener" onClick={() => setOpen(true)}>Open</button>
    {open && <Dialog title="Test" onClose={() => { if (!keep) setOpen(false); }}><button id="inside">Inside</button></Dialog>}
  </main>;
}

function mount(keep = false) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Harness, { keep })));
  const opener = document.getElementById("opener") as HTMLButtonElement;
  opener.focus();
  act(() => opener.click());
  return opener;
}

test("closing returns focus to the element that opened the dialog", () => {
  const opener = mount();
  expect(document.querySelector("dialog")?.open).toBe(true);
  act(() => (document.querySelector('[aria-label="Close dialog"]') as HTMLButtonElement).click());
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.activeElement).toBe(opener);
});

test("a native close (browser close watcher) closes the React dialog too", async () => {
  mount();
  const dialog = document.querySelector("dialog")!;
  await act(async () => { dialog.close(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(document.querySelector("dialog")).toBeNull();
  expect(document.body.style.overflow).not.toBe("hidden");
});

test("a dialog that refuses to close is shown again after a native close", async () => {
  mount(true);
  const dialog = document.querySelector("dialog")!;
  await act(async () => { dialog.close(); await new Promise(resolve => setTimeout(resolve, 10)); });
  expect(document.querySelector("dialog")?.open).toBe(true);
});

test("Escape in a dialog opened from another dialog closes only the inner one", () => {
  const closed: string[] = [];
  function Nested() {
    const [inner, setInner] = useState(true);
    return <Dialog title="Outer" onClose={() => closed.push("outer")}>
      {inner && <Dialog title="Inner" onClose={() => { closed.push("inner"); setInner(false); }}><button>Inside</button></Dialog>}
    </Dialog>;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(createElement(Nested)));
  const inner = document.querySelector('dialog[aria-label="Inner"]')!;
  act(() => { inner.dispatchEvent(new Event("cancel", { cancelable: true })); });
  expect(closed).toEqual(["inner"]);
});
