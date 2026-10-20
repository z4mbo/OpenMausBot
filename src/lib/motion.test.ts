import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EASE_OUT, MOTION_MS } from "./motion";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const token = (name: string) => new RegExp(String.raw`--${name}:\s*([^;]+);`).exec(css)?.[1]?.trim();

describe("motion tokens", () => {
  it("gives scripts the same durations as the stylesheet", () => {
    for (const [name, ms] of Object.entries(MOTION_MS)) expect(token(`motion-${name}`)).toBe(`${ms}ms`);
  });

  it("gives scripts the stylesheet's ease-out curve", () => {
    expect(token("ease-out")).toBe(EASE_OUT);
  });
});
