import { describe, expect, it } from "vitest";
import { createSpeechSegmenter, liveCaptions } from "./call-agent";

const run = (segmenter: ReturnType<typeof createSpeechSegmenter>, frames: [level: number, at: number][]) =>
  frames.map(([level, at]) => segmenter.feed(level, at));

describe("createSpeechSegmenter", () => {
  it("sends an utterance after the pause that follows it", () => {
    const segmenter = createSpeechSegmenter({ speech: 0.1, pauseMs: 900, voicedMs: 200 });
    segmenter.reset(0);
    expect(run(segmenter, [[0.5, 100], [0.5, 200], [0.5, 300], [0.5, 400], [0, 800], [0, 1_200]])).toEqual([null, null, null, null, null, null]);
    expect(segmenter.feed(0, 1_300)).toBe("send");
  });

  it("ignores a click too short to be speech and drops silence", () => {
    const segmenter = createSpeechSegmenter({ speech: 0.1, pauseMs: 900, voicedMs: 250, idleMs: 8_000, longestMs: 15_000 });
    segmenter.reset(0);
    expect(run(segmenter, [[0.9, 90], [0, 2_000]])).toEqual([null, null]);
    expect(segmenter.feed(0, 15_000)).toBe("drop");
    segmenter.reset(20_000);
    expect(segmenter.feed(0, 28_000)).toBe("drop");
  });

  it("cuts a long monologue at its longest", () => {
    const segmenter = createSpeechSegmenter({ speech: 0.1, longestMs: 1_000, voicedMs: 100 });
    segmenter.reset(0);
    expect(run(segmenter, [[0.5, 300], [0.5, 600], [0.5, 900]])).toEqual([null, null, null]);
    expect(segmenter.feed(0.5, 1_000)).toBe("send");
  });
});

describe("liveCaptions", () => {
  it("shows the latest few recent lines", () => {
    const lines = [1, 2, 3, 4].map((id) => ({ id, at: id * 1_000, speaker: "Ana", text: `line ${id}` }));
    expect(liveCaptions(lines, 4_500).map((line) => line.id)).toEqual([2, 3, 4]);
    expect(liveCaptions(lines, 12_500).map((line) => line.id)).toEqual([4]);
  });
});
