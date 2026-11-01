import { expect, test } from "vitest";
import { initials, memberName } from "./user-avatar";

test("initials come from the full name", () => {
  expect(initials({ name: "Alex Morgan", username: "demo", email: "demo@origin.test" })).toBe("AM");
  expect(initials({ name: "Ada Lovelace King" })).toBe("AK");
  expect(initials({ name: "Priya" })).toBe("P");
  expect(initials({ username: "priya.demo" })).toBe("PD");
  expect(initials({ email: "mei@origin.test" })).toBe("M");
  expect(initials({})).toBe("O");
});

test("memberName prefers the full name over the handle", () => {
  expect(memberName({ name: "Priya Shah", username: "priya.demo", email: "priya@origin.test" })).toBe("Priya Shah");
  expect(memberName({ username: "priya.demo", email: "priya@origin.test" })).toBe("priya.demo");
  expect(memberName({ email: "priya@origin.test" })).toBe("priya");
  expect(memberName({})).toBe("Member");
});
