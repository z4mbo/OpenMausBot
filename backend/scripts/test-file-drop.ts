import assert from "node:assert/strict";
import { createElement, type DragEvent } from "react";
import { renderToString } from "react-dom/server";
import { useFileDrop } from "../components/use-file-drop";

let handlers: ReturnType<typeof useFileDrop>["handlers"];
const received: File[][] = [], links: string[] = [];
function Harness({ disabled = false }) {
  handlers = useFileDrop({ disabled, onFiles: files => received.push(files), onLink: url => links.push(url) }).handlers;
  return null;
}
const files = [new File(["one"], "one.txt"), new File(["two"], "two.txt")];
function event(types: string[], selected: File[] = [], text = "") {
  let prevented = false;
  const value = { dataTransfer: { types, files: selected, dropEffect: "", getData: () => text }, preventDefault: () => { prevented = true; }, stopPropagation: () => {} };
  return { value: value as unknown as DragEvent, prevented: () => prevented };
}
renderToString(createElement(Harness));
const drop = event(["Files"], files); handlers!.onDrop(drop.value);
assert.deepEqual(received, [files]); assert.ok(drop.prevented());
const link = event(["text/uri-list"], [], "https://example.com/reference"); handlers!.onDrop(link.value);
assert.deepEqual(links, ["https://example.com/reference"]);
handlers!.onDrop(event(["text/plain"], [], "javascript:alert(1)").value); assert.equal(links.length, 1);
renderToString(createElement(Harness, { disabled: true }));
const disabled = event(["Files"], files); handlers!.onDragOver(disabled.value); handlers!.onDrop(disabled.value);
assert.ok(disabled.prevented(), "A disabled area must not navigate to the dropped file");
assert.equal(disabled.value.dataTransfer.dropEffect, "none"); assert.equal(received.length, 1);
console.log("PASS file drop batches, dropped links, unsafe links and disabled-area navigation protection");
