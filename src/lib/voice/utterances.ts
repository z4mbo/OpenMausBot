export const VOICE_SAMPLE_RATE = 16_000;

const WINDOW = 320;
const PRE_ROLL_WINDOWS = 15;
const START_WINDOWS = 3;
const END_SILENCE_WINDOWS = 35;
const MIN_SPEECH_WINDOWS = 12;
const MAX_WINDOWS = 15 * (VOICE_SAMPLE_RATE / WINDOW);
const CALIBRATION_WINDOWS = 25;
const MIN_LEVEL = 0.012;
const FLOOR_RATIO = 3;

export interface UtteranceDetector {
  /** Mono float samples at 16 kHz; returns a finished utterance as PCM16 when one ends. */
  push(samples: Float32Array): Int16Array | null;
  reset(): void;
  readonly speaking: boolean;
}

function rms(window: Float32Array): number {
  let sum = 0;
  for (const sample of window) sum += sample * sample;
  return Math.sqrt(sum / window.length);
}

function toPcm16(windows: Float32Array[]): Int16Array {
  const out = new Int16Array(windows.length * WINDOW);
  let i = 0;
  for (const window of windows) {
    for (const sample of window) {
      const clamped = Math.max(-1, Math.min(1, sample));
      out[i++] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
    }
  }
  return out;
}

export function createUtteranceDetector(): UtteranceDetector {
  let pending = new Float32Array(WINDOW);
  let filled = 0;
  let floor = MIN_LEVEL / FLOOR_RATIO;
  let calibration: number[] | null = [];
  let preRoll: Float32Array[] = [];
  let utterance: Float32Array[] | null = null;
  let loudRun = 0;
  let silentRun = 0;
  let speechWindows = 0;

  const reset = () => {
    filled = 0;
    preRoll = [];
    utterance = null;
    loudRun = 0;
    silentRun = 0;
    speechWindows = 0;
  };

  const finish = (): Int16Array | null => {
    const windows = utterance;
    const enough = speechWindows >= MIN_SPEECH_WINDOWS;
    utterance = null;
    preRoll = [];
    loudRun = 0;
    silentRun = 0;
    speechWindows = 0;
    return windows && enough ? toPcm16(windows) : null;
  };

  const take = (window: Float32Array): Int16Array | null => {
    const level = rms(window);
    if (calibration) {
      calibration.push(level);
      preRoll.push(window);
      if (calibration.length < CALIBRATION_WINDOWS) return null;
      const sorted = [...calibration].sort((a, b) => a - b);
      floor = Math.max(floor, sorted[Math.floor(sorted.length / 2)]);
      calibration = null;
      preRoll = preRoll.slice(-PRE_ROLL_WINDOWS);
      return null;
    }
    const loud = level > Math.max(MIN_LEVEL, floor * FLOOR_RATIO);
    if (!loud && !utterance) floor = floor * 0.95 + level * 0.05;
    if (!utterance) {
      preRoll.push(window);
      if (preRoll.length > PRE_ROLL_WINDOWS) preRoll.shift();
      loudRun = loud ? loudRun + 1 : 0;
      if (loudRun >= START_WINDOWS) {
        utterance = [...preRoll];
        speechWindows = loudRun;
        silentRun = 0;
      }
      return null;
    }
    utterance.push(window);
    if (loud) {
      speechWindows += 1;
      silentRun = 0;
    } else {
      silentRun += 1;
    }
    if (silentRun >= END_SILENCE_WINDOWS || utterance.length >= MAX_WINDOWS) return finish();
    return null;
  };

  return {
    push(samples) {
      let done: Int16Array | null = null;
      let offset = 0;
      while (offset < samples.length) {
        const count = Math.min(WINDOW - filled, samples.length - offset);
        pending.set(samples.subarray(offset, offset + count), filled);
        filled += count;
        offset += count;
        if (filled === WINDOW) {
          const window = pending;
          pending = new Float32Array(WINDOW);
          filled = 0;
          done = take(window) ?? done;
        }
      }
      return done;
    },
    reset,
    get speaking() {
      return utterance !== null;
    },
  };
}
