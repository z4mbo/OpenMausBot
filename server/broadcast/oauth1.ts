import { createHmac } from "node:crypto";

export interface OAuth1Credentials {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessSecret: string;
}

/** RFC 3986 percent-encoding, which OAuth 1.0a signs with (encodeURIComponent leaves !'()* alone). */
export function percentEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * The Authorization header of an OAuth 1.0a HMAC-SHA1 request. `formParams` are the fields of an
 * application/x-www-form-urlencoded body; JSON and multipart bodies are not signed.
 */
export function oauth1Header(
  method: string, url: string, credentials: OAuth1Credentials,
  { nonce, timestamp, formParams = {} }: { nonce: string; timestamp: number; formParams?: Record<string, string> },
): string {
  const target = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp),
    oauth_token: credentials.accessToken,
    oauth_version: "1.0",
  };
  const pairs: [string, string][] = [...target.searchParams.entries(), ...Object.entries(formParams), ...Object.entries(oauth)]
    .map(([key, value]) => [percentEncode(key), percentEncode(value)]);
  pairs.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : x > y ? 1 : 0) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), percentEncode(`${target.origin}${target.pathname}`), percentEncode(pairs.map(([key, value]) => `${key}=${value}`).join("&"))].join("&");
  const signature = createHmac("sha1", `${percentEncode(credentials.apiSecret)}&${percentEncode(credentials.accessSecret)}`).update(base).digest("base64");
  return `OAuth ${Object.entries({ ...oauth, oauth_signature: signature }).map(([key, value]) => `${percentEncode(key)}="${percentEncode(value)}"`).join(", ")}`;
}
