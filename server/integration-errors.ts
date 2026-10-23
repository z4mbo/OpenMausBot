import { isSecretName, redactSecretsInText } from "./redact.ts";

export function integrationCredentialSecrets(credentials: object): string[] {
  return Object.entries(credentials).filter(([name, value]) => isSecretName(name) && typeof value === "string").map(([, value]) => String(value));
}

export function integrationHeaderSecrets(headers: RequestInit["headers"]): string[] {
  const values: string[] = [];
  new Headers(headers).forEach((value, name) => {
    if (!isSecretName(name)) return;
    values.push(value);
    if (name !== "authorization") return;
    const [scheme, credential] = value.split(/\s+/, 2);
    if (!credential) return;
    values.push(credential);
    if (scheme.toLowerCase() === "basic") {
      const decoded = Buffer.from(credential, "base64").toString("utf8");
      values.push(decoded, decoded.slice(decoded.indexOf(":") + 1));
    }
  });
  return values;
}

export function integrationErrorScrubber(secrets: readonly string[]): (message: string) => string {
  const values = [...new Set(secrets.filter(Boolean).flatMap(value => [value, encodeURIComponent(value), JSON.stringify(value).slice(1, -1)]))].sort((a, b) => b.length - a.length);
  return message => redactSecretsInText(values.reduce((result, value) => result.replaceAll(value, "[redacted]"), message));
}
