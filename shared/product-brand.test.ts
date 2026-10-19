import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { APP_NAME } from "./product-brand.mjs";

it("uses the Origin name when the browser installs the app on a home screen", () => {
  const manifest = JSON.parse(readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8"));
  expect(manifest.name).toBe(APP_NAME);
  expect(manifest.short_name).toBe(APP_NAME);
  expect(manifest.id).toBe("/");
  expect(manifest.start_url).toBe("/");
});

it("names the speech helper's permission prompts without changing its saved permission identity", () => {
  const plist = readFileSync(new URL("../electron/resources/speech-helper-Info.plist", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  expect(plist).toContain(`<key>CFBundleDisplayName</key>\n    <string>${APP_NAME}</string>`);
  expect(plist).toContain("<string>com.openmausbot.app.speech-helper</string>");
  expect(plist).toContain(`${APP_NAME} listens while you dictate`);
});
