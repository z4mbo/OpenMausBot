import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../plugins/origin/", import.meta.url);
const readJson = async path => JSON.parse(await readFile(new URL(path, root), "utf8"));
const manifest = await readJson("plugin.json");
const legacy = await readJson(".codex-plugin/plugin.json");
const mcp = await readJson("mcp.json");
const legacyMcp = await readJson(".mcp.json");
assert.equal(manifest.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
assert.equal(mcp.$schema, "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json");
assert.equal(manifest.name, "origin");
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
for (const key of ["skills", "mcpServers", "apps", "interface"]) assert.equal(manifest[key], undefined);
for (const key of ["name", "version", "description", "author"]) assert.deepEqual(manifest[key], legacy[key]);
const ui = manifest.extensions["com.openai"].interface;
assert.deepEqual(ui, legacy.interface);
for (const key of ["composerIcon", "logo", "logoDark"]) {
  assert.equal(ui[key], "./assets/icon.png");
  const icon = await readFile(new URL(ui[key], root));
  assert.equal(icon.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(icon.readUInt32BE(16), 256);
  assert.equal(icon.readUInt32BE(20), 256);
}
assert.equal(ui.defaultPrompt.length, 3);
assert.equal(mcp.mcpServers.origin.type, "streamable-http");
assert.equal(mcp.mcpServers.origin.url, "https://your-origin.example/api/mcp");
assert.equal(mcp.mcpServers.origin.url, legacyMcp.mcpServers.origin.url);
assert.deepEqual(Object.keys(mcp.mcpServers.origin).sort(), ["type", "url"]);
const skill = await readFile(new URL("skills/origin/SKILL.md", root), "utf8");
assert.match(skill, /^---\nname: origin\ndescription: .+\n---/);
for (const safeguard of ["untrusted", "Confirm", "read-only", "revoked", "request ID"]) assert.ok(skill.includes(safeguard));
const allowed = new Set(["plugin.json", "mcp.json", ".mcp.json", ".codex-plugin/plugin.json", "README.md", "skills/origin/SKILL.md", "assets/icon.svg", "assets/icon.png"]);
async function inspect(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${prefix}${entry.name}`;
    assert.ok(!entry.isSymbolicLink(), `Do not package symlinks: ${path}`);
    if (entry.isDirectory()) await inspect(new URL(`${entry.name}/`, directory), `${path}/`);
    else {
      assert.ok(allowed.has(path), `Review new package file before uploading: ${path}`);
      const text = await readFile(new URL(entry.name, directory), "utf8");
      assert.doesNotMatch(text, /(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\/Users\/)/);
    }
  }
}
await inspect(root);
console.log(`PASS portable manifests, legacy parity, workflow safeguards and archive allowlist: ${fileURLToPath(root)}`);
