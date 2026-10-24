import { createUtteranceDetector, VOICE_SAMPLE_RATE } from "./utterances";

export interface UtteranceMicrophone {
  start(): Promise<void>;
  /** While muted no audio is kept or handed on, so the agent's own voice is never transcribed. */
  setMuted(muted: boolean): void;
  stop(): void;
}

const WORKLET = `class OmbVoiceTap extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("omb-voice-tap", OmbVoiceTap);`;

export class MicrophoneError extends Error {}

/** Chromium resamples the microphone to the context's 16 kHz rate, which is what whisper.cpp expects. */
export function createUtteranceMicrophone(onUtterance: (pcm16: Int16Array) => void): UtteranceMicrophone {
  const detector = createUtteranceDetector();
  let stream: MediaStream | null = null;
  let context: AudioContext | null = null;
  let muted = false;
  let stopped = false;

  const release = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    void context?.close().catch(() => {});
    context = null;
  };

  return {
    async start() {
      stopped = false;
      if (!globalThis.navigator?.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") throw new MicrophoneError("no microphone API");
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      } catch (error) {
        throw new MicrophoneError(error instanceof Error ? error.message : String(error));
      }
      if (stopped) return void media.getTracks().forEach((track) => track.stop());
      stream = media;
      const audio = new AudioContext({ sampleRate: VOICE_SAMPLE_RATE });
      context = audio;
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try {
        await audio.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      if (stopped) return release();
      const tap = new AudioWorkletNode(audio, "omb-voice-tap");
      tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (muted || stopped) return;
        const utterance = detector.push(event.data);
        if (utterance) onUtterance(utterance);
      };
      audio.createMediaStreamSource(media).connect(tap);
      // Chromium only pulls audio through a node that reaches the destination; a muted gain keeps the tap silent.
      const silent = audio.createGain();
      silent.gain.value = 0;
      tap.connect(silent).connect(audio.destination);
    },
    setMuted(next) {
      if (next === muted) return;
      muted = next;
      detector.reset();
    },
    stop() {
      stopped = true;
      detector.reset();
      release();
    },
  };
}
