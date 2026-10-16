import { createHmac, timingSafeEqual } from "node:crypto";
import { readBoundedText } from "./http-body";

export function originUrl() {
  const configured = process.env.ORIGIN_PUBLIC_URL || process.env.ORIGIN_SITE_URL;
  if (!configured && process.env.NODE_ENV === "production") throw new Error("Set ORIGIN_PUBLIC_URL for this instance");
  const url = new URL(configured || "http://localhost:3000");
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("ORIGIN_PUBLIC_URL must be an application origin");
  return url.origin;
}

export function signIntegration(body: string) {
  const secret = process.env.ORIGIN_INTEGRATION_SECRET;
  if (!secret || secret.length < 32) throw new Error("Integration service is not configured");
  return createHmac("sha256", secret).update(body).digest("hex");
}
export async function readIntegrationRequest(request: Request) {
  const body = await readBoundedText(request, 100000);
  const signature = request.headers.get("x-origin-signature") || "";
  if (!/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(signIntegration(body), "hex"))) throw new Error("Unauthorized");
  const payload = JSON.parse(body);
  if (typeof payload.at !== "number" || Math.abs(Date.now() - payload.at) > 60000) throw new Error("Request expired");
  return payload;
}
export async function integrationBridge<T>(operation: string, args: unknown): Promise<T> {
  const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (!site) throw new Error("Convex site URL missing");
  const body = JSON.stringify({ at: Date.now(), operation, args });
  const response = await fetch(`${site}/integrations`, { method: "POST", body, headers: { "Content-Type": "application/json", "x-origin-signature": signIntegration(body) }, signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!response.ok) throw new Error(`Integration update failed (${response.status})`);
  return response.json();
}
