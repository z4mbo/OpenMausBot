import { describe, expect, it } from "vitest";
import { selectCallFocus } from "./call-layout";

const self = { id: "self:camera" };
const priya = { id: "priya:camera" };
const jonas = { id: "jonas:camera" };
const screen = { id: "jonas:screen", screenSharing: true };

describe("call stage focus", () => {
  it("shows your camera while you are alone", () => {
    expect(selectCallFocus([self], null, new Set())).toBe("self:camera");
  });
  it("moves to the first teammate who joins", () => {
    expect(selectCallFocus([self, priya], "self:camera", new Set())).toBe("priya:camera");
  });
  it("keeps your camera when you chose it", () => {
    expect(selectCallFocus([self, priya], "self:camera", new Set(), true)).toBe("self:camera");
  });
  it("keeps a teammate on stage when another joins", () => {
    expect(selectCallFocus([self, priya, jonas], "priya:camera", new Set())).toBe("priya:camera");
  });
  it("gives the stage to a newly shared screen, then keeps it", () => {
    expect(selectCallFocus([self, priya, jonas, screen], "priya:camera", new Set(), true)).toBe("jonas:screen");
    expect(selectCallFocus([self, priya, jonas, screen], "priya:camera", new Set(["jonas:screen"]), true)).toBe("priya:camera");
  });
  it("falls back when the tile on stage leaves", () => {
    expect(selectCallFocus([self, jonas], "priya:camera", new Set(), true)).toBe("jonas:camera");
  });
});
