import { describe, expect, it } from "vitest";
import { contrastRatio, filledTextInk, fromOklch, parseHex, toOklch } from "./color-contrast";
import { MAUS_COLORS } from "./mascot";

describe("filled text ink", () => {
  it("keeps normal text readable across an RGB color grid", () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const fill = `#${[r, g, b].map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
          for (const dark of ["#101410", "#111111"]) {
            expect(contrastRatio(filledTextInk(fill, dark), fill), `${fill} / ${dark}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });
});

describe("oklch", () => {
  it.each(Object.entries(MAUS_COLORS))("round-trips %s through OKLCH", (_name, hex) => {
    const back = parseHex(fromOklch(toOklch(hex)));
    const want = parseHex(hex);
    expect(Math.abs(back.r - want.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.g - want.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(back.b - want.b)).toBeLessThanOrEqual(1);
  });

  it("reads white and black at the ends of lightness with no chroma", () => {
    expect(toOklch("#ffffff").l).toBeCloseTo(1, 3);
    expect(toOklch("#000000").l).toBeCloseTo(0, 3);
    expect(toOklch("#808080").c).toBeLessThan(0.001);
  });

  it("gives up chroma, not lightness or hue, to stay inside sRGB", () => {
    const wanted = { l: 0.5, c: 0.4, h: 145 };
    const got = toOklch(fromOklch(wanted));
    expect(got.l).toBeCloseTo(wanted.l, 2);
    expect(Math.abs(got.h - wanted.h)).toBeLessThan(2);
    expect(got.c).toBeLessThan(wanted.c);
  });
});
