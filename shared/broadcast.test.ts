import { describe, expect, it } from "vitest";
import { channelProblems, countText, mediaKindOf } from "./broadcast.ts";

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
