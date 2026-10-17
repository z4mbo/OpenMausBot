import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({ resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } }, test: { environment: "node", include: ["testing/pg3-sandbox.ts"], maxWorkers: 1, testTimeout: 60000 } });
