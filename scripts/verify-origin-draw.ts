import { fileURLToPath } from "node:url";
import { launchVerificationServer } from "./control-omb.ts";
import { mountPreview, parkUntilSignal } from "./testing/preview-fixture.ts";
const fixture = await launchVerificationServer();
const cloud = fileURLToPath(new URL("./testing/origin-draw-cloud.ts", import.meta.url));
let preview: Awaited<ReturnType<typeof mountPreview>> | undefined;
try {
  const uploads = new Map<string, { type: string; body: Buffer }>();
  preview = await mountPreview(fixture, { entry: "/scripts/testing/origin-draw-preview.tsx", route: "/__origin-draw.html", title: "Isolated Origin canvas", extraRoutes: [
    { path: "/__origin-draw-upload", method: "POST", handler: async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const storageId = `upload-${uploads.size + 1}`;
      uploads.set(storageId, { type: String(req.headers["content-type"] ?? "application/octet-stream"), body: Buffer.concat(chunks) });
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ storageId }));
    } },
    { path: /^\/__origin-draw-file\/([\w-]+)$/, handler: (_req, res, match) => {
      const file = uploads.get(match?.[1] ?? "");
      if (!file) { res.statusCode = 404; res.end(); return; }
      res.setHeader("content-type", file.type);
      res.end(file.body);
    } },
  ], aliases: [
    { find: /^@\/lib\/origin-cloud(?:\/client)?$/, replacement: cloud },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] });
  console.log(JSON.stringify({ ...fixture.info, previewUrl: preview.previewUrl }));
  await parkUntilSignal();
} finally { await preview?.close(); await fixture.close(); }
