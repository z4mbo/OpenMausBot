import { describe, expect, it } from "vitest";
import { integrationCredentialSecrets, integrationErrorScrubber, integrationHeaderSecrets } from "./integration-errors.ts";

describe("integration credential errors", () => {
  it("captures raw, URL encoded and JSON escaped secrets before a key can rotate", () => {
    const credentials = { apiKey: 'private+/"\\credential', senderEmail: "public@example.test" };
    const scrub = integrationErrorScrubber(integrationCredentialSecrets(credentials));
    const original = credentials.apiKey;
    credentials.apiKey = "rotated-credential";
    const result = scrub(`HTTP 401 ${original} ${encodeURIComponent(original)} ${JSON.stringify(original)}; public@example.test`);
    expect(result).not.toContain(original);
    expect(result).not.toContain(encodeURIComponent(original));
    expect(result).not.toContain(JSON.stringify(original).slice(1, -1));
    expect(result).toContain("HTTP 401");
    expect(result).toContain("public@example.test");
  });

  it("removes both Basic authorization and its underlying password", () => {
    const password = "twilio-private-password";
    const encoded = Buffer.from(`ACpublic:${password}`).toString("base64");
    const scrub = integrationErrorScrubber(integrationHeaderSecrets({ Authorization: `Basic ${encoded}` }));
    const result = scrub(`HTTP 401 Basic ${encoded}; ${password}; ACpublic`);
    expect(result).not.toContain(encoded);
    expect(result).not.toContain(password);
    expect(result).toContain("HTTP 401");
    expect(result).toContain("ACpublic");
  });

  it("includes Key, Bearer and named API headers without treating public fields as secret", () => {
    expect(integrationHeaderSecrets({ Authorization: "Key private-fal", "api-key": "private-brevo", "content-type": "application/json" })).toEqual(expect.arrayContaining(["private-fal", "private-brevo"]));
    expect(integrationHeaderSecrets({ Authorization: "Bearer private-channel" })).toContain("private-channel");
    expect(integrationCredentialSecrets({ appPassword: "private-password", pageAccessToken: "private-token", handle: "me.test" })).toEqual(["private-password", "private-token"]);
  });
});
