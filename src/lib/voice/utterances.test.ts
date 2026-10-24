import { describe, expect, it } from "vitest";

import { createUtteranceDetector, VOICE_SAMPLE_RATE } from "./utterances";

function tone(seconds: number, amplitude: number): Float32Array {
  const out = new Float32Array(Math.round(seconds * VOICE_SAMPLE_RATE));
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / VOICE_SAMPLE_RATE);
  return out;
}

function feed(detector: ReturnType<typeof createUtteranceDetector>, ...parts: Float32Array[]): Int16Array[] {
  const found: Int16Array[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 128) {
      const utterance = detector.push(part.subarray(i, i + 128));
      if (utterance) found.push(utterance);
    }
  }
  return found;
}

describe("utterance detector", () => {
  it("cuts one utterance per spoken phrase, with a little audio from before it began", () => {
    const detector = createUtteranceDetector();
    const found = feed(detector, tone(1, 0.002), tone(1.2, 0.3), tone(1, 0.002), tone(0.8, 0.3), tone(1, 0.002));
    expect(found).toHaveLength(2);
    const seconds = found.map((pcm) => pcm.length / VOICE_SAMPLE_RATE);
    expect(seconds[0]).toBeGreaterThan(1.2);
    expect(seconds[0]).toBeLessThan(2.4);
    expect(Math.max(...found[0])).toBeGreaterThan(9_000);
  });

  it("ignores silence, steady background noise and short clicks", () => {
    const detector = createUtteranceDetector();
    expect(feed(detector, tone(3, 0.001))).toHaveLength(0);
    expect(feed(detector, tone(2, 0.008), tone(0.08, 0.4), tone(2, 0.008))).toHaveLength(0);
  });

  it("raises its threshold in a noisy room", () => {
    const detector = createUtteranceDetector();
    expect(feed(detector, tone(3, 0.02), tone(1, 0.03), tone(1, 0.02))).toHaveLength(0);
    expect(feed(detector, tone(1, 0.3), tone(1, 0.02))).toHaveLength(1);
  });

  it("ends a phrase that runs too long", () => {
    const detector = createUtteranceDetector();
    const found = feed(detector, tone(0.5, 0.001), tone(20, 0.3));
    expect(found).toHaveLength(1);
    expect(found[0].length / VOICE_SAMPLE_RATE).toBeLessThanOrEqual(15);
  });

  it("forgets a half-heard phrase when reset", () => {
    const detector = createUtteranceDetector();
    feed(detector, tone(0.5, 0.001), tone(0.5, 0.3));
    expect(detector.speaking).toBe(true);
    detector.reset();
    expect(detector.speaking).toBe(false);
    expect(feed(detector, tone(1, 0.001))).toHaveLength(0);
  });
});
