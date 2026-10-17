import { describe, expect, it } from "vitest";
import { ORIGIN_CLOUD_URL, originServerFor } from "./servers";

describe("originServerFor", () => {
  it("maps the Origin website to its backend", () => {
    expect(originServerFor("https://origin.imbored.fun")).toBe(ORIGIN_CLOUD_URL);
    expect(originServerFor("origin.imbored.fun/")).toBe(ORIGIN_CLOUD_URL);
  });
  it("keeps a backend address as it is", () => {
    expect(originServerFor("http://127.0.0.1:3210/")).toBe("http://127.0.0.1:3210");
    expect(originServerFor(ORIGIN_CLOUD_URL)).toBe(ORIGIN_CLOUD_URL);
  });
});
