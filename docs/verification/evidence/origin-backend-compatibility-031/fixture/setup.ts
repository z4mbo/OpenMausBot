import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
const directory = resolve(import.meta.dirname, "data");
mkdirSync(directory, { recursive: true });
process.env.OMB_DATA_DIR = directory;
delete process.env.ORIGIN_LEGACY_OWNER_EMAIL;
delete process.env.ORIGIN_LEGACY_GITHUB_TOKEN;
delete process.env.GITHUB_TOKEN;
delete process.env.GH_TOKEN;
