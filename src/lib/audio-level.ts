/** A tile counts as speaking above this level. */
export const SPEAKING_LEVEL = 0.12;

/** Loudness of one time-domain frame of unsigned bytes (128 is silence), scaled so ordinary speech spans most of 0 to 1. */
export function frameLevel(frame: ArrayLike<number>): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let index = 0; index < frame.length; index++) {
    const sample = (frame[index]! - 128) / 128;
    sum += sample * sample;
  }
  return Math.min(1, Math.sqrt(sum / frame.length) * 4);
}

/** Rises at once and falls slowly, so a meter does not flicker between words. */
export function smoothLevel(previous: number, next: number): number {
  return next >= previous ? next : previous * 0.8 + next * 0.2;
}

let shared: AudioContext | null = null;

function audioContext(): AudioContext | null {
  const Context = globalThis.AudioContext ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return null;
  shared ??= new Context();
  if (shared.state === "suspended") void shared.resume().catch(() => {});
  return shared;
}

/** Reports the stream's microphone level every `intervalMs` until the returned function stops it. */
export function watchAudioLevel(stream: MediaStream, onLevel: (level: number) => void, intervalMs = 90): () => void {
  const track = stream.getAudioTracks()[0];
  const context = track ? audioContext() : null;
  if (!track || !context) {
    onLevel(0);
    return () => {};
  }
  const source = context.createMediaStreamSource(new MediaStream([track]));
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.5;
  source.connect(analyser);
  const frame = new Uint8Array(analyser.fftSize);
  let level = 0;
  const timer = globalThis.setInterval(() => {
    analyser.getByteTimeDomainData(frame);
    level = smoothLevel(level, track.enabled && track.readyState === "live" ? frameLevel(frame) : 0);
    onLevel(level);
  }, intervalMs);
  return () => {
    globalThis.clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
  };
}
