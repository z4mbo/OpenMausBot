import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const session = JSON.parse(await readFile("/tmp/origin-qa-session.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const errors = [];
const clients = [];
try {
  for (const user of [session.alex, session.sam]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(token => { localStorage.setItem("origin.sessionToken", token); }, user.sessionToken);
    await context.addInitScript(() => {
      const Peer = window.RTCPeerConnection;
      window.__testPeers = [];
      window.RTCPeerConnection = class extends Peer { constructor(config) { super(config); window.__testPeers.push(this); } };
      const syntheticVideo = (screen) => {
        const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
        const paint = () => { const ctx = canvas.getContext("2d"); ctx.fillStyle = screen ? "#1c806a" : "#1c5880"; ctx.fillRect(0, 0, 640, 360); ctx.fillStyle = "white"; ctx.font = "32px sans-serif"; ctx.fillText(screen ? "Synthetic shared screen" : "Synthetic camera", 35, 180); ctx.fillRect(Date.now() % 580, 230, 30, 30); };
        paint(); setInterval(paint, 100); return canvas.captureStream(15);
      };
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = constraints.video ? syntheticVideo(false) : new MediaStream();
        if (constraints.audio) { const audio = new AudioContext(); const oscillator = audio.createOscillator(); const gain = audio.createGain(); gain.gain.value = 0; const dest = audio.createMediaStreamDestination(); oscillator.connect(gain); gain.connect(dest); oscillator.start(); stream.addTrack(dest.stream.getAudioTracks()[0]); }
        return stream;
      };
      navigator.mediaDevices.getDisplayMedia = async () => syntheticVideo(true);
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/api/local-voice/config?*", route => route.fulfill({ json: { iceServers: [] } }));
    await page.goto(`http://127.0.0.1:3001/${session.workspace.slug}?view=voice`);
    await page.getByRole("button", { name: /Join call|Start call/ }).last().click();
    clients.push(page);
  }
  const [alex, sam] = clients;
  for (const page of clients) {
    await page.waitForFunction(() => window.__testPeers.some(peer => peer.connectionState === "connected"), { timeout: 30000 });
    await page.waitForFunction(() => [...document.querySelectorAll("video")].some(video => !video.muted && video.videoWidth > 0));
  }
  console.log("PASS two-browser call with real local WebRTC connection and synthetic media");
  await alex.getByRole("button", { name: "Share screen", exact: true }).click();
  await sam.locator(".screen-share-tile").waitFor();
  await sam.waitForFunction(() => document.querySelector(".screen-share-tile video")?.videoWidth > 0);
  await sam.screenshot({ path: "/tmp/origin-call-screen-qa.png" });
  await alex.getByRole("button", { name: "Draw", exact: true }).click();
  assert.ok(await alex.evaluate(() => window.__testPeers.some(peer => peer.connectionState === "connected")));
  await alex.getByRole("button", { name: /^Call/ }).click();
  await alex.getByRole("button", { name: "Stop sharing", exact: true }).click();
  await alex.getByRole("button", { name: "Leave call", exact: true }).click();
  await sam.getByRole("button", { name: "Leave call", exact: true }).click();
  console.log("PASS screen share, navigation without disconnecting, stop sharing and hangup");
  assert.deepEqual(errors, []);
} catch (error) {
  for (const [i, page] of clients.entries()) {
    console.log("Call diagnostics", i, await page.evaluate(() => ({ notice: [...document.querySelectorAll(".notice")].map(e => e.textContent), peers: window.__testPeers.map(p => ({ connection: p.connectionState, ice: p.iceConnectionState, signalling: p.signalingState })) })));
    await page.screenshot({ path: `/tmp/origin-call-failure-${i}.png` });
  }
  throw error;
} finally { await browser.close(); }
