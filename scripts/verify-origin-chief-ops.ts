import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import { launchVerificationServer } from "./control-omb.ts";
import { parkUntilSignal, REPO_ROOT } from "./testing/preview-fixture.ts";

const fixture = await launchVerificationServer();
const ui = await createServer({
  root: REPO_ROOT,
  cacheDir: join(fixture.info.dataDir, "vite-chief-ops-cache"),
  optimizeDeps: { entries: ["scripts/testing/origin-chief-ops-preview.tsx"] },
  resolve: { alias: [
    { find: /^@\/lib\/origin-cloud$/, replacement: fileURLToPath(new URL("./testing/origin-chief-ops-cloud.ts", import.meta.url)) },
    { find: "@", replacement: fileURLToPath(new URL("../src", import.meta.url)) },
  ] },
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: { ignored: ["**/.omb-scratch/**"] }, proxy: { "/api": { target: fixture.info.url } } },
  plugins: [{ name: "isolated-origin-pages", configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if ((req.url ?? "").split("?")[0] !== "/__origin-chief-ops.html") return next();
      void server.transformIndexHtml("/__origin-chief-ops.html", '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Origin isolated chief ops</title></head><body><div id="root"></div><script type="module" src="/scripts/testing/origin-chief-ops-preview.tsx"></script></body></html>')
        .then((html) => { res.setHeader("content-type", "text/html"); res.end(html); }).catch(next);
    });
  } }],
});
try {
  await ui.listen();
  console.log(JSON.stringify({ ...fixture.info, previewUrl: new URL("/__origin-chief-ops.html", ui.resolvedUrls!.local[0]).href }));
  await parkUntilSignal();
} finally { await ui.close(); await fixture.close(); }
