import { existsSync } from "node:fs";
import { splitCliString } from "../env-path.ts";

/** Ask the configured executable to update itself, so a non-PATH Codex is the one updated. */
export function codexUpdateCommand(cli: string, platform: NodeJS.Platform = process.platform): string {
  if (cli === "codex") return "codex update";
  const trimmed = cli.trim();
  const tokens = trimmed.includes(" ") && existsSync(trimmed) ? [trimmed] : splitCliString(trimmed);
  const quote = platform === "win32"
    ? (token: string) => `'${token.replaceAll("'", "''")}'`
    : (token: string) => `'${token.replaceAll("'", `'\\''`)}'`;
  const command = (tokens.length > 0 ? tokens : [trimmed]).map(quote).join(" ");
  return platform === "win32" ? `& ${command} update` : `${command} update`;
}
