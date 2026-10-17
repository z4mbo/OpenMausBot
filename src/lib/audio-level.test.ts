import { describe, expect, it } from "vitest";
import { SPEAKING_LEVEL, frameLevel, smoothLevel } from "./audio-level";

describe("audio level", () => {
  it("reads silence as zero and an empty frame as zero", () => {
    expect(frameLevel(new Uint8Array(256).fill(128))).toBe(0);
    expect(frameLevel([])).toBe(0);
  });

  it("puts ordinary speech above the speaking threshold and clips loud input at one", () => {
    const speech = Array.from({ length: 256 }, (_, index) => 128 + Math.round(12 * Math.sin(index / 4)));
    expect(frameLevel(speech)).toBeGreaterThan(SPEAKING_LEVEL);
    expect(frameLevel(Array.from({ length: 256 }, (_, index) => (index % 2 ? 255 : 0)))).toBe(1);
  });

  it("rises at once and decays slowly", () => {
    expect(smoothLevel(0.1, 0.6)).toBe(0.6);
    const fallen = smoothLevel(0.6, 0);
    expect(fallen).toBeLessThan(0.6);
    expect(fallen).toBeGreaterThan(0.4);
  });
});
