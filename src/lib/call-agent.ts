import { useEffect, useRef, useState } from "react";
import { SPEAKING_LEVEL, watchAudioLevel } from "./audio-level";
import { originRealtime, type RealtimeTarget } from "./origin-realtime";
import { speaker } from "./tts";

/** An AI agent taking part in a member call. Its `stream`, once it has one, is played and drives the tile's speaking indicator. */
export type CallAgentParticipant = {
  botId: string;
  state: "joining" | "listening" | "thinking" | "speaking" | "failed";
  stream?: MediaStream;
  error?: string;
};

/** One line of the call's live transcript, as the server keeps it for the agent. */
export type CallCaption = { id: number; at: number; speaker: string; userId?: string; text: string; agent?: true };

export type CallAgentEngine = "local" | "groq" | "openai" | "browser";

type AgentView = { botId: string; name: string; addedBy: string; startedAt: number; state: "listening" | "thinking"; engine: CallAgentEngine; keepTranscript: boolean; awaiting?: string };
type EndedView = { botId: string; name: string; status: "summarizing" | "posted" | "failed"; error?: string; at: number };
type AgentState = { agent: AgentView | null; lines: CallCaption[]; cursor: number; ended: EndedView | null };

const AGENT = "/api/local-voice/agent";
const AGENT_AUDIO = "/api/local-voice/agent-audio";
const POLL_MS = 1_200;
const CAPTION_MS = 9_000;
const MAX_CAPTIONS = 40;
const ENDED_SHOWN_MS = 30_000;

/** Cuts one person's microphone into utterances: a segment is sent after a pause that follows speech, or at its longest,
 * and dropped when nobody spoke, so silence never reaches the transcription engine. */
export function createSpeechSegmenter(options: { speech?: number; pauseMs?: number; longestMs?: number; idleMs?: number; voicedMs?: number } = {}) {
  const speech = options.speech ?? SPEAKING_LEVEL;
  const pauseMs = options.pauseMs ?? 900;
  const longestMs = options.longestMs ?? 15_000;
  const idleMs = options.idleMs ?? 8_000;
  const minimumVoiced = options.voicedMs ?? 250;
  let started = 0;
  let lastVoice = 0;
  let lastAt = 0;
  let voiced = 0;
  return {
    reset(at: number) {
      started = at;
      lastAt = at;
      lastVoice = 0;
      voiced = 0;
    },
    feed(level: number, at: number): "send" | "drop" | null {
      if (level >= speech) {
        voiced += Math.max(0, at - lastAt);
        lastVoice = at;
      }
      lastAt = at;
      const spoke = voiced >= minimumVoiced;
      if (spoke && (at - lastVoice >= pauseMs || at - started >= longestMs)) return "send";
      if (!spoke && at - started >= (lastVoice ? longestMs : idleMs)) return "drop";
      return null;
    },
  };
}

/** The lines worth showing as captions right now: the latest few, none older than `CAPTION_MS`. */
export function liveCaptions(lines: readonly CallCaption[], now: number, count = 3): CallCaption[] {
  return lines.filter((line) => now - line.at < CAPTION_MS).slice(-count);
}

type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
};

function recognitionClass(): (new () => Recognition) | null {
  const scope = globalThis as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition ?? null;
}

type Transcriber = { pause(paused: boolean): void; stop(): void };
type Heard = { text(said: string): void; interim(said: string): void; error(message: string): void };

function recorderType(): string {
  const types = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) ?? "";
}

/** Records the person's own microphone in memory, one utterance at a time, and hands each one over as it ends. */
function recordUtterances(stream: MediaStream, send: (audio: Blob) => void, heard: Heard): Transcriber {
  const track = stream.getAudioTracks()[0];
  if (!track || typeof MediaRecorder === "undefined") {
    heard.error("This app can't record the microphone for transcription");
    return { pause() {}, stop() {} };
  }
  const type = recorderType();
  const source = new MediaStream([track]);
  const segmenter = createSpeechSegmenter();
  let paused = false;
  let current: ((keep: boolean) => void) | null = null;
  const begin = () => {
    const recorder = new MediaRecorder(source, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    let keep = false;
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = () => { if (keep && chunks.length) send(new Blob(chunks, { type: recorder.mimeType || type })); };
    recorder.start();
    segmenter.reset(Date.now());
    return (kept: boolean) => {
      keep = kept;
      if (recorder.state !== "inactive") recorder.stop();
    };
  };
  const rotate = (keep: boolean, restart: boolean) => {
    const finish = current;
    current = restart ? begin() : null;
    finish?.(keep);
  };
  current = begin();
  const unwatch = watchAudioLevel(source, (level) => {
    if (paused || !current) return;
    const verdict = segmenter.feed(level, Date.now());
    if (verdict) rotate(verdict === "send", true);
  });
  return {
    pause(next) {
      if (next === paused) return;
      paused = next;
      rotate(false, !next);
    },
    stop() {
      unwatch();
      rotate(false, false);
    },
  };
}

/** The browser's own speech recognition: the text, not the audio, leaves the person's machine for this server. */
function recognizeSpeech(heard: Heard): Transcriber {
  const Recognition = recognitionClass();
  if (!Recognition) {
    heard.error("This app has no built-in speech recognition. An admin can pick another engine in Settings > Model providers.");
    return { pause() {}, stop() {} };
  }
  let active = true;
  let paused = false;
  const recognition = new Recognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";
  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]!;
      if (result.isFinal) heard.text(result[0].transcript);
      else interim += result[0].transcript;
    }
    heard.interim(interim);
  };
  recognition.onerror = (event) => {
    if (event.error === "not-allowed" || event.error === "service-not-allowed" || event.error === "network") {
      active = false;
      heard.error(event.error === "network" ? "Speech recognition is not available in this app" : "Speech recognition was not allowed");
    }
  };
  const listen = () => {
    try {
      recognition.start();
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "InvalidStateError")) heard.error("Speech recognition could not start");
    }
  };
  recognition.onend = () => { if (active && !paused) listen(); };
  listen();
  return {
    pause(next) {
      paused = next;
      if (next) recognition.stop();
      else if (active) listen();
    },
    stop() {
      active = false;
      recognition.onend = null;
      recognition.stop();
    },
  };
}

/** Reads the agent's answer aloud on this machine: the agent's voice when the harness has one, else the system voice. */
async function speakAloud(text: string, botId: string, voiceId: string | undefined): Promise<void> {
  await speaker.speak(text, { botId, ...(voiceId ? { voiceId } : {}) });
  if (!speaker.state.error || typeof window === "undefined" || !window.speechSynthesis) return;
  await new Promise<void>((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

/**
 * The one agent a call may bring in. Everyone in the call sees it, its captions and that it is listening; each person's
 * own microphone is transcribed while it is there, and its answers are read aloud on every machine. Leaving the call
 * stops this person's part; removing the agent ends it for everyone, and the server then summarises the call.
 */
export function useCallAgent(target: RealtimeTarget, botId: string | undefined, localStream: MediaStream | null, voiceId?: string) {
  const [state, setState] = useState<AgentState | null>(null);
  const [captions, setCaptions] = useState<CallCaption[]>([]);
  const [joining, setJoining] = useState(false);
  const [failure, setFailure] = useState("");
  const [notice, setNotice] = useState("");
  const [interim, setInterim] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const cursor = useRef(0);
  const spokenUpTo = useRef<number | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const targetKey = `${target.teamId}:${target.room ?? ""}`;
  const api = <T,>(path: string, init?: Parameters<typeof originRealtime>[2]) => originRealtime<T>(path, targetRef.current, init);

  useEffect(() => {
    cursor.current = 0;
    spokenUpTo.current = null;
    setState(null);
    setCaptions([]);
    if (!localStream) return;
    let alive = true;
    let session = 0;
    const load = () => api<AgentState>(AGENT, { query: { after: String(cursor.current) } }).then((next) => {
      if (!alive) return;
      if (!next.agent || next.agent.startedAt !== session) {
        session = next.agent?.startedAt ?? 0;
        cursor.current = 0;
        spokenUpTo.current = next.agent ? next.cursor : null;
        setCaptions([]);
      }
      if (next.agent) {
        cursor.current = next.cursor;
        if (next.lines.length) setCaptions((current) => [...current, ...next.lines.filter((line) => !current.some((seen) => seen.id === line.id))].slice(-MAX_CAPTIONS));
      }
      setState(next);
    }).catch(() => {});
    void load();
    const timer = window.setInterval(load, POLL_MS);
    return () => { alive = false; window.clearInterval(timer); };
  }, [localStream, targetKey]);

  const agent = state?.agent && state.agent.botId === botId ? state.agent : null;
  const engine = agent?.engine;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const transcriber = useRef<Transcriber | null>(null);
  useEffect(() => {
    if (!agent || !localStream || !engine) return;
    setNotice("");
    const heard: Heard = {
      text: (said) => {
        setInterim("");
        if (said.trim()) void api(AGENT, { json: { action: "line", text: said } }).catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Transcription failed"));
      },
      interim: setInterim,
      error: setNotice,
    };
    const running = engine === "browser"
      ? recognizeSpeech(heard)
      : recordUtterances(localStream, (audio) => {
        void api<{ line: CallCaption | null }>(AGENT_AUDIO, { body: audio, query: { mime: audio.type } })
          .then(() => setNotice(""))
          .catch((error: unknown) => setNotice(error instanceof Error ? error.message : "Transcription failed"));
      }, heard);
    transcriber.current = running;
    return () => {
      running.stop();
      transcriber.current = null;
      setInterim("");
    };
  }, [Boolean(agent), localStream, engine, targetKey]);

  useEffect(() => { transcriber.current?.pause(speaking); }, [speaking]);

  const queue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => {
    if (!agent || spokenUpTo.current === null) return;
    const fresh = captions.filter((line) => line.agent && line.id > spokenUpTo.current!);
    if (!fresh.length) return;
    spokenUpTo.current = fresh.at(-1)!.id;
    for (const line of fresh) {
      queue.current = queue.current.then(async () => {
        setSpeaking(true);
        try {
          await speakAloud(line.text, agent.botId, voiceId);
        } finally {
          setSpeaking(false);
        }
      });
    }
  }, [captions, agent?.botId]);

  const speakingRef = useRef(false);
  speakingRef.current = speaking;
  useEffect(() => {
    if (!localStream && speakingRef.current) speaker.stop();
    return () => { if (speakingRef.current) speaker.stop(); };
  }, [localStream]);

  const add = () => {
    if (!botId || !localStream || joining || agent) return;
    setJoining(true);
    setFailure("");
    void api<{ agent: AgentView }>(AGENT, { json: { action: "join", botId } })
      .then((result) => setState((current) => ({ lines: [], cursor: 0, ended: null, ...current, agent: result.agent })))
      .catch((error: unknown) => {
        setFailure(error instanceof Error ? error.message : "The agent could not join");
        window.setTimeout(() => setFailure(""), 4_000);
      })
      .finally(() => setJoining(false));
  };

  const remove = () => {
    if (!agent) return;
    speaker.stop();
    void api(AGENT, { json: { action: "leave" } }).then(() => setState((current) => current && { ...current, agent: null })).catch(() => {});
  };

  const setKeep = (keep: boolean) => {
    void api(AGENT, { json: { action: "keep", keep } }).then(() => setState((current) => current?.agent ? { ...current, agent: { ...current.agent, keepTranscript: keep } } : current)).catch(() => {});
  };

  const participant: CallAgentParticipant | null = !botId ? null
    : agent ? { botId, state: speaking ? "speaking" : agent.state }
    : joining ? { botId, state: "joining" }
    : failure ? { botId, state: "failed", error: failure }
    : null;

  return {
    available: Boolean(botId && localStream),
    participant,
    add,
    remove,
    /** Who brought the agent in, and whether the transcript stays after the summary. */
    session: agent ? { addedBy: agent.addedBy, keepTranscript: agent.keepTranscript, awaiting: agent.awaiting, engine: agent.engine } : null,
    setKeep,
    captions: liveCaptions(captions, now),
    interim,
    notice,
    ended: state?.ended && now - state.ended.at < ENDED_SHOWN_MS ? state.ended : null,
  };
}

export type CallAgentControls = ReturnType<typeof useCallAgent>;
