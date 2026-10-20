import { describe, expect, it } from "vitest";
import { TYPICAL_SLOTS, bestTimes, channelProblems, countText, hashtagsOf, mediaKindOf, nextSlot, reelProblems, withHashtag, withoutHashtag } from "./broadcast.ts";

describe("countText", () => {
  it("counts X links as 23 and wide characters as two", () => {
    expect(countText("x", "Read https://example.com/a/very/long/path/that/is/long")).toBe(5 + 23);
    expect(countText("x", "日本")).toBe(4);
  });

  it("counts Bluesky by grapheme", () => {
    expect(countText("bluesky", "👩‍👩‍👧 hi")).toBe(4);
  });
});

describe("channelProblems", () => {
  it("accepts a fitting post", () => {
    expect(channelProblems("x", "Hello", ["image"])).toEqual([]);
  });

  it("names each rule a post breaks", () => {
    expect(channelProblems("x", "a".repeat(300), [])).toEqual(["X allows 280 characters; this is 300"]);
    expect(channelProblems("instagram", "Caption", [])).toEqual(["Instagram needs an image or a video"]);
    expect(channelProblems("tiktok", "Caption", ["image"])).toEqual(["TikTok needs exactly one video"]);
    expect(channelProblems("bluesky", "Clip", ["video"])).toEqual(["Bluesky takes images only here"]);
    expect(channelProblems("x", "Hi", ["image", "image", "image", "image", "image"])).toEqual(["X takes up to 4 images"]);
    expect(channelProblems("facebook", "Hi", ["video", "image"])).toEqual(["Facebook takes one video on its own"]);
  });
});

describe("mediaKindOf", () => {
  it("reads the content type, then the file name", () => {
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("image/svg+xml")).toBe("other");
    expect(mediaKindOf(undefined, "cover.JPG")).toBe("image");
  });
});

describe("hashtags", () => {
  it("adds a tag on a trailing line once and removes it again", () => {
    const tagged = withHashtag("Launch day", "launch");
    expect(tagged).toBe("Launch day\n\n#launch");
    expect(withHashtag(tagged, "#Launch")).toBe(tagged);
    expect(withHashtag(tagged, "ship it")).toBe("Launch day\n\n#launch #shipit");
    expect(withoutHashtag("Launch day\n\n#launch #shipit", "#launch")).toBe("Launch day\n\n#shipit");
    expect(withoutHashtag("Ship it #now please", "#now")).toBe("Ship it please");
    expect(hashtagsOf("a #one, b#not #two")).toEqual(["#one", "#two"]);
  });

  it("refuses an Instagram caption over 30 hashtags", () => {
    const caption = Array.from({ length: 31 }, (_, index) => `#t${index}`).join(" ");
    expect(channelProblems("instagram", caption, ["image"])).toEqual(["Instagram allows 30 hashtags; this has 31"]);
    expect(channelProblems("x", caption.slice(0, 200), [])).toEqual([]);
  });
});

describe("reels", () => {
  it("need exactly one video on channels that take reels", () => {
    expect(reelProblems(["instagram", "tiktok"], ["video"])).toEqual([]);
    expect(reelProblems(["instagram", "linkedin"], ["image"])).toEqual(["LinkedIn does not take reels", "A reel is exactly one video"]);
  });
});

describe("best times", () => {
  const at = (weekday: number, hour: number, weeksAgo: number) => {
    const day = new Date(2026, 9, 18 - 7 * weeksAgo);
    day.setDate(day.getDate() + weekday);
    day.setHours(hour, 0, 0, 0);
    return day.getTime();
  };
  const sample = (weekday: number, hour: number, weeksAgo: number, likes: number) => ({ channel: "x" as const, publishedAt: at(weekday, hour, weeksAgo), metrics: { likes, reposts: 0, replies: 0 } });

  it("ranks weekly slots by the mean engagement of measured posts", () => {
    const { measured, slots } = bestTimes([sample(2, 9, 1, 100), sample(2, 9, 2, 60), sample(4, 12, 1, 50), sample(5, 17, 1, 5)], ["x"]);
    expect(measured).toBe(true);
    expect(slots.map(({ weekday, hour, score }) => [weekday, hour, score])).toEqual([[2, 9, 80], [4, 12, 50], [5, 17, 5]]);
  });

  it("offers the channels' typical slots until there are enough measured posts", () => {
    expect(bestTimes([sample(2, 9, 1, 100)], ["linkedin"])).toEqual({ measured: false, slots: TYPICAL_SLOTS.linkedin.map((slot) => ({ ...slot, posts: 0 })) });
  });

  it("finds the next occurrence of a slot", () => {
    const now = new Date(2026, 9, 20, 10).getTime();
    expect(new Date(nextSlot({ weekday: 2, hour: 9 }, now)).getDate()).toBe(27);
    expect(new Date(nextSlot({ weekday: 2, hour: 11 }, now)).getDate()).toBe(20);
    expect(nextSlot({ weekday: 3, hour: 8 }, now)).toBe(new Date(2026, 9, 21, 8).getTime());
  });
});
