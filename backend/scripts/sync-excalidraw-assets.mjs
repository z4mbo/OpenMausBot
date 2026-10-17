import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const packageDirectory = join(dirname(require.resolve("@excalidraw/excalidraw")), "../..");
const destination = new URL("../public/excalidraw/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(join(packageDirectory, "dist/prod/fonts"), new URL("fonts/", destination), { recursive: true });
console.log("Excalidraw font assets are available locally");
