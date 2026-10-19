import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { defineConfig, mergeConfig, normalizePath } from "vite";
import original from "../vite.config.ts";
const root = normalizePath(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const overrides = new Map(["src/components/origin-pages/NewIssueComposer.tsx", "src/components/origin-pages/FeedbackPage.tsx", "src/components/origin-pages/IssuesPage.tsx", "server/origin-cloud.ts", "server/origin-mcp.ts"].map(path => [normalizePath(join(root,path)),execFileSync("git",["show",`0757f71888d2c5aaf41bd877724949a63d815aa2:${path}`],{cwd:root,encoding:"utf8",maxBuffer:4*1024*1024})]));
export default mergeConfig(original,defineConfig({plugins:[{name:"frozen-draft-baseline",enforce:"pre",load(id){return overrides.get(normalizePath(id.split("?")[0]));}}]}));
