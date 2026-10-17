import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.OMB_VERIFY_PLAYWRIGHT || "playwright");
const url = new URL(process.argv[2]);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/__origin-real-peers.html");
const marker = await (await fetch(new URL("/__peer-fixture/evidence", url))).json();
assert.equal(marker.fixtureKind, "origin-native-real-peers-v1");
const directory = new URL("../../docs/verification/evidence/origin-calls/", import.meta.url);
await mkdir(directory, { recursive: true });
const output = name => fileURLToPath(new URL(name, directory));
const source = execFileSync("git", ["rev-parse", "HEAD"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" }).trim();
const evidence = { source, checkedAt: new Date().toISOString(), previewUrl: url.href, syntheticIdentities: true, nativePeerConnection: true, fakeHardwareOnly: true, iceServers: [], pageErrors: [], rejectedExternalRequests: [], cases: [] };
const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--autoplay-policy=no-user-gesture-required", "--disable-features=WebRtcHideLocalIpsWithMdns"] });
const contexts = [];
const pages = [];
const snapshot = async (page) => page.evaluate(async () => ({
  peers: await Promise.all(window.__peerEvidence.peers.map(async (peer) => ({ connectionState: peer.connectionState, iceConnectionState: peer.iceConnectionState, signalingState: peer.signalingState,
    iceServers: peer.getConfiguration().iceServers, receivers: peer.getReceivers().map((receiver) => ({ kind: receiver.track.kind, readyState: receiver.track.readyState, muted: receiver.track.muted })),
    stats: [...(await peer.getStats()).values()].filter((row) => ["inbound-rtp", "outbound-rtp", "candidate-pair"].includes(row.type)).map((row) => ({ type: row.type, kind: row.kind, packetsReceived: row.packetsReceived, bytesReceived: row.bytesReceived, packetsSent: row.packetsSent, bytesSent: row.bytesSent, framesDecoded: row.framesDecoded, state: row.state, nominated: row.nominated }))
  }))),
  capturedTracks: window.__peerEvidence.tracks.map((track) => ({ id: track.id, kind: track.kind, readyState: track.readyState, enabled: track.enabled })),
  audio: [...document.querySelectorAll("audio")].map((element) => ({ paused: element.paused, readyState: element.readyState, currentTime: element.currentTime, tracks: element.srcObject?.getTracks().map((track) => ({ kind: track.kind, readyState: track.readyState })) })),
  videos: [...document.querySelectorAll("[data-call-tile]")].map((element) => ({ label: element.getAttribute("data-call-tile"), videoReadyState: element.querySelector("video")?.readyState, videoWidth: element.querySelector("video")?.videoWidth })),
}));
async function makePeer(peer) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, permissions: ["camera", "microphone"] });
  contexts.push(context);
  await context.route("**/*", async (route) => {
    const target = new URL(route.request().url());
    if (["data:", "blob:"].includes(target.protocol) || target.hostname === "127.0.0.1") await route.continue();
    else { evidence.rejectedExternalRequests.push(target.origin); await route.abort(); }
  });
  await context.routeWebSocket("**/*", (socket) => socket.close());
  await context.addInitScript(() => {
    const NativePeer = window.RTCPeerConnection;
    window.__peerEvidence = { peers: [], tracks: [] };
    window.RTCPeerConnection = class extends NativePeer { constructor(...args) { super(...args); window.__peerEvidence.peers.push(this); } };
    const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (...args) => { const stream = await capture(...args); window.__peerEvidence.tracks.push(...stream.getTracks()); return stream; };
  });
  const page = await context.newPage();
  pages.push(page);
  page.on("pageerror", (error) => evidence.pageErrors.push({ peer, error: error.message }));
  await page.goto(`${url.href}?peer=${peer}`);
  await page.getByRole("button", { name: /^(Start|Join) call$/ }).click();
  await page.getByRole("toolbar", { name: "Call controls" }).waitFor();
  return page;
}
async function connected(page) {
  await page.waitForFunction(() => window.__peerEvidence.peers.some((peer) => peer.connectionState === "connected"), null, { timeout: 25_000 });
  await page.waitForFunction(async () => { const peer = window.__peerEvidence.peers.find((peer) => peer.connectionState === "connected"); const rows = [...(await peer.getStats()).values()]; return ["audio", "video"].every((kind) => rows.some((row) => row.type === "inbound-rtp" && row.kind === kind && row.packetsReceived > 0)); }, null, { timeout: 20_000 });
}
try {
  const a = await makePeer("a");
  const b = await makePeer("b");
  await Promise.all([connected(a), connected(b)]);
  await Promise.all([a, b].map(page => page.waitForFunction(() => [...document.querySelectorAll("audio")].some(element => element.readyState >= 2 && !element.paused && element.currentTime > 0))));
  evidence.initialA = await snapshot(a);
  evidence.initialB = await snapshot(b);
  for (const state of [evidence.initialA, evidence.initialB]) {
    const peer = state.peers.find((peer) => peer.connectionState === "connected");
    assert.deepEqual(peer.iceServers, []);
    assert.ok(peer.receivers.some((track) => track.kind === "audio" && track.readyState === "live" && !track.muted));
    assert.ok(peer.receivers.some((track) => track.kind === "video" && track.readyState === "live" && !track.muted));
    assert.ok(state.audio.some((element) => element.readyState >= 2 && !element.paused && element.currentTime > 0));
  }
  evidence.cases.push("Two independent browser contexts connected through real offer/answer/candidate HTTP signaling and exchanged nonzero native audio and video RTP packets");
  await a.getByRole("button", { name: "Raise hand", exact: true }).click();
  await b.locator('[data-call-tile="Peer A"]').getByText("Hand raised", { exact: true }).waitFor();
  evidence.cases.push("Peer A raised hand arrived on Peer B over the native negotiated data channel");
  await a.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await b.locator('[data-call-tile="Peer A"]').getByLabel("Microphone off", { exact: true }).waitFor({ timeout: 8000 });
  await a.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  await b.locator('[data-call-tile="Peer A"]').getByLabel("Microphone off", { exact: true }).waitFor({ state: "detached", timeout: 8000 });
  evidence.cases.push("Mute/unmute presence propagated to the remote tile");
  await a.screenshot({ path: output("real-peer-a-connected.png") });
  await b.screenshot({ path: output("real-peer-b-connected.png") });
  const replacement = await makePeer("a");
  await a.getByText("This call ended or was joined on another device. Join again to continue.", { exact: true }).waitFor({ timeout: 12000 });
  await Promise.all([connected(replacement), connected(b)]);
  const oldACallTrackIds = evidence.initialA.capturedTracks.filter((track) => track.readyState === "live").map((track) => track.id);
  assert.ok(oldACallTrackIds.length >= 2);
  await a.waitForFunction((ids) => window.__peerEvidence.peers.every((peer) => peer.connectionState === "closed") && window.__peerEvidence.tracks.filter((track) => ids.includes(track.id)).every((track) => track.readyState === "ended"), oldACallTrackIds);
  evidence.replacedA = await snapshot(a);
  evidence.replacementA = await snapshot(replacement);
  evidence.reconnectedB = await snapshot(b);
  evidence.cases.push("A second browser session for Peer A replaced the old session, closed its native peers and stopped its call capture tracks; the replacement reconnected to Peer B. Fresh lobby-preview capture is intentionally separate");
  const finalCallIds = [evidence.replacementA, evidence.reconnectedB].map((state) => state.capturedTracks.filter((track) => track.readyState === "live").map((track) => track.id));
  assert.ok(finalCallIds.every(ids => ids.length >= 2));
  await replacement.getByRole("button", { name: "Leave call", exact: true }).click();
  await replacement.getByRole("toolbar", { name: "Call controls" }).waitFor({ state: "detached" });
  await b.waitForFunction(() => window.__peerEvidence.peers.every((peer) => peer.connectionState === "closed"), null, { timeout: 8000 });
  await b.getByRole("button", { name: "Leave call", exact: true }).click();
  await b.getByRole("toolbar", { name: "Call controls" }).waitFor({ state: "detached" });
  for (const [index, page] of [replacement, b].entries()) await page.waitForFunction((ids) => window.__peerEvidence.tracks.filter((track) => ids.includes(track.id)).every((track) => track.readyState === "ended") && window.__peerEvidence.peers.every((peer) => peer.connectionState === "closed"), finalCallIds[index]);
  evidence.finalReplacementA = await snapshot(replacement);
  evidence.finalB = await snapshot(b);
  evidence.server = await (await fetch(new URL("/__peer-fixture/evidence", url))).json();
  assert.deepEqual(evidence.server.participants, []);
  assert.ok(evidence.server.calls.some((call) => call.kind === "offer"));
  assert.ok(evidence.server.calls.some((call) => call.kind === "answer"));
  assert.ok(evidence.server.calls.some((call) => call.kind === "candidate"));
  assert.deepEqual(evidence.pageErrors, []);
  assert.deepEqual(evidence.rejectedExternalRequests, []);
  evidence.cases.push("Leaving both peers emptied production SQLite presence; all owned peer connections closed and all call capture tracks ended. New lobby preview tracks stop when the browser contexts close");
  evidence.status = "passed";
} catch (error) {
  evidence.status = "failed";
  evidence.failure = error.stack;
  evidence.debug = await Promise.all(pages.map(async (page) => ({ text: await page.locator("body").innerText().catch(() => "closed"), state: await snapshot(page).catch((e) => e.message) })));
  throw error;
} finally {
  await writeFile(output("real-peer-calls-result.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log(JSON.stringify({ status: evidence.status, cases: evidence.cases, failure: evidence.failure, pageErrors: evidence.pageErrors, rejectedExternalRequests: evidence.rejectedExternalRequests }));
  for (const context of contexts) await context.close();
  await browser.close();
}
