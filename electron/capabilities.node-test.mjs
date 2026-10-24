import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { desktopCapabilities } = require("./capabilities.cjs");

test("a remote server's page is told this computer offers no screen, voice or local control", () => {
  const local = desktopCapabilities({ platform: "darwin", env: {}, packaged: true, localConnection: { status: "ready", enabled: true } });
  const remote = desktopCapabilities({ platform: "darwin", env: {}, packaged: true, localConnection: { status: "ready", enabled: true }, remote: true });
  assert.equal(local.remote, false);
  assert.equal(local.screenPreview.available, true);
  assert.equal(remote.remote, true);
  assert.deepEqual(remote.screenPreview, { available: false, interaction: "none", reasonCode: "remote-server" });
  assert.equal(remote.dictation.available, false);
  assert.equal(remote.dictation.reasonCode, "remote-server");
  assert.equal(remote.localComputer.available, false);
  assert.equal(remote.localComputer.enabled, false);
  assert.equal(remote.localComputer.reasonCode, "remote-server");
  assert.equal(remote.host.platform, "darwin");
  assert.equal(remote.host.homeDir, "");
  assert.notEqual(local.host.homeDir, "");
});

test("the wake phrase is heard by whisper.cpp on Windows and Apple speech on macOS, never for a remote page", () => {
  const voice = (options) => desktopCapabilities({ env: {}, ...options }).localVoice;
  assert.deepEqual(voice({ platform: "darwin", arch: "arm64" }), { engine: "apple-speech" });
  assert.deepEqual(voice({ platform: "win32", arch: "x64" }), { engine: "whisper" });
  assert.deepEqual(voice({ platform: "win32", arch: "arm64" }), { engine: "whisper" });
  assert.deepEqual(voice({ platform: "win32", arch: "ia32" }), { engine: "none", reasonCode: "unsupported-platform" });
  assert.deepEqual(voice({ platform: "linux", arch: "x64" }), { engine: "none", reasonCode: "unsupported-platform" });
  assert.deepEqual(voice({ platform: "win32", arch: "x64", remote: true }), { engine: "none", reasonCode: "remote-server" });
});
