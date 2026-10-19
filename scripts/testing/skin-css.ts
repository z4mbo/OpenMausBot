import { readFileSync } from "node:fs";

export function readSkinCss(): string {
  const theme = readFileSync(new URL("../../shared/origin-theme.css", import.meta.url), "utf8");
  const tokens = Object.fromEntries([...theme.matchAll(/(--origin-[\w-]+)\s*:\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
  const css = readFileSync(new URL("../../src/styles.css", import.meta.url), "utf8")
    .replace('@import "../shared/origin-theme.css";', "");
  return theme + "\n" + css.replace(/var\((--origin-[\w-]+)\)/g, (_, name: string) => {
    if (tokens[name] === undefined) throw new Error(`Unresolved Origin theme token: ${name}`);
    return tokens[name];
  });
}
