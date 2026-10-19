import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MemberCall, MemberCallHost } from "../../src/components/origin-pages/CallPage";
import { MemberCallBanner } from "../../src/components/MemberCallBanner";
import { primaryButton } from "../../src/components/origin-pages/ui";
import { initialState, StoreContext } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import { setSessionToken } from "../../src/lib/origin-cloud/client";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "atelier" : "midnight");
setSessionToken("fixture-call-token");
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
  getUserMedia: async () => new MediaStream(), enumerateDevices: async () => [], addEventListener() {}, removeEventListener() {},
} });
if (params.has("blockedAudio")) {
  const request = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await request(input, init);
    if (String(input).startsWith("/api/local-voice/participants?") && (!init?.method || init.method === "GET")) {
      const body = await response.json();
      return Response.json({ ...body, participants: [...body.participants, { userId: "fixtureremoteperson", name: "Remote person", email: "remote@example.test", audioEnabled: true, videoEnabled: false, joinedAt: 1, lastSeenAt: Date.now(), sessionId: "fixture-remote-session" }] });
    }
    return response;
  };
  const track = new AudioContext().createMediaStreamDestination().stream.getAudioTracks()[0]!;
  Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: class {
    connectionState = "connected";
    signalingState = "stable";
    transceivers: { receiver: { track: { kind: string } }; sender: { replaceTrack(): Promise<void> } }[] = [];
    set ontrack(listener: ((event: { track: MediaStreamTrack }) => void) | null) { if (listener) window.setTimeout(() => listener({ track }), 50); }
    addTransceiver(kind: string) { this.transceivers.push({ receiver: { track: { kind } }, sender: { replaceTrack: async () => {} } }); }
    getTransceivers() { return this.transceivers; }
    createDataChannel() { return { readyState: "connecting" }; }
    close() {}
  } });
  const sources = new WeakMap<HTMLMediaElement, MediaStream | null>();
  const source = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "srcObject")!;
  Object.defineProperty(HTMLMediaElement.prototype, "srcObject", {
    configurable: true,
    get(this: HTMLMediaElement) { return this instanceof HTMLAudioElement ? sources.get(this) ?? null : source.get?.call(this); },
    set(this: HTMLMediaElement, value: MediaStream | null) { if (this instanceof HTMLAudioElement) sources.set(this, value); else source.set?.call(this, value); },
  });
  let blocked = true;
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest('[aria-label="Play audio from Remote person"]')) blocked = false;
  }, true);
  HTMLMediaElement.prototype.play = function () {
    if (this instanceof HTMLAudioElement && blocked) return Promise.reject(new DOMException("Synthetic autoplay refusal", "NotAllowedError"));
    return Promise.resolve();
  };
}
const me = { _id: "fixturecalluser", name: "Fixture user", email: "fixture@example.test" };
function Fixture() {
  const [room, setRoom] = useState("fixturefirstroom");
  const [status, setStatus] = useState("");
  const trigger = async (action: string) => {
    const response = await fetch(`/__call-fixture/${action}`, { method: "POST" });
    if (!response.ok) throw new Error(`Fixture ${action} failed`);
    setStatus(action);
  };
  return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
    <div className="flex shrink-0 flex-wrap gap-2 border-b border-hairline p-2">
      <button className={primaryButton} onClick={() => setRoom("fixturefirstroom")}>First room</button>
      <button className={primaryButton} onClick={() => setRoom("fixtureotherroom")}>Second room</button>
      <button className={primaryButton} onClick={() => void trigger("release")}>Release delayed leave</button>
      <button className={primaryButton} onClick={() => void trigger(`replace?room=${room}`)}>Join from another device</button>
      <output className="text-xs" aria-label="Fixture status">{status}</output>
    </div>
    <MemberCallHost />
    <MemberCall key={room} target={{ teamId: "fixturecallteam", room }} me={me} canJoin name={room === "fixturefirstroom" ? "First room" : "Second room"} open={() => {}} />
    <MemberCallBanner />
  </main>;
}
createRoot(document.getElementById("root")!).render(<StoreContext.Provider value={{ state: initialState, dispatch: () => {}, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Fixture /></StoreContext.Provider>);
