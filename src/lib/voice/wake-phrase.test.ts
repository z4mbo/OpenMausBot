import { describe, expect, it } from "vitest";

import { matchWakePhrase } from "./wake-phrase";

const origin = { id: "origin", name: "Origin" };
const pepper = { id: "pepper", name: "Pepper" };
const launch = { id: "launch", name: "Launch Pad" };

describe("matchWakePhrase", () => {
  it("hears the Italian and English wake words", () => {
    expect(matchWakePhrase("Ehi Origin", [origin])).toMatchObject({ id: "origin", rest: "" });
    expect(matchWakePhrase("Hey, Origin.", [origin])).toMatchObject({ id: "origin", rest: "" });
    expect(matchWakePhrase("hei origin", [origin])?.id).toBe("origin");
    expect(matchWakePhrase("Éhi Orìgin!", [origin])?.id).toBe("origin");
  });

  it("keeps a question asked in the same breath, as it was spoken", () => {
    expect(matchWakePhrase("Hey Origin, what's the status of the launch?", [origin])?.rest).toBe("what's the status of the launch?");
    expect(matchWakePhrase("ok ehi Origin come va il progetto", [origin])?.rest).toBe("come va il progetto");
  });

  it("accepts names the recogniser mis-heard", () => {
    expect(matchWakePhrase("hey oregon", [origin])?.id).toBe("origin");
    expect(matchWakePhrase("hey orijin", [origin])?.id).toBe("origin");
    expect(matchWakePhrase("hey peppa", [pepper])?.id).toBe("pepper");
    expect(matchWakePhrase("hey origin", [origin])!.score).toBe(1);
    expect(matchWakePhrase("hey oregon", [origin])!.score).toBeLessThan(1);
  });

  it("joins or splits words of a multi-word name", () => {
    expect(matchWakePhrase("hey launchpad", [launch])?.id).toBe("launch");
    expect(matchWakePhrase("hey launch pad open the issues", [launch])?.rest).toBe("open the issues");
    expect(matchWakePhrase("hey launch, any news?", [launch])?.id).toBe("launch");
  });

  it("hears a wake word glued to the name", () => {
    expect(matchWakePhrase("heyorigin", [origin])?.id).toBe("origin");
  });

  it("ignores speech without the wake word or the name", () => {
    expect(matchWakePhrase("origin is a nice name", [origin])).toBeNull();
    expect(matchWakePhrase("hey there", [origin])).toBeNull();
    expect(matchWakePhrase("hey Marco, are you coming?", [origin, pepper])).toBeNull();
    expect(matchWakePhrase("", [origin])).toBeNull();
    expect(matchWakePhrase("hey origin", [])).toBeNull();
  });

  it("asks short names to be heard exactly", () => {
    const ada = { id: "ada", name: "Ada" };
    expect(matchWakePhrase("hey ada", [ada])?.id).toBe("ada");
    expect(matchWakePhrase("hey adam", [ada])).toBeNull();
    expect(matchWakePhrase("hey anna", [ada])).toBeNull();
  });

  it("picks the closest of several projects", () => {
    expect(matchWakePhrase("hey pepper", [origin, pepper])?.id).toBe("pepper");
    expect(matchWakePhrase("ehi origin", [pepper, origin])?.id).toBe("origin");
  });
});
