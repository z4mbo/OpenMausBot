import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { limitLocalAction } from "@/lib/localRealtime";
import { integrationBridge, originUrl } from "@/lib/integration-bridge";
import { BodyTooLarge, readBoundedText } from "@/lib/http-body";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    if (request.headers.get("origin") !== new URL(originUrl()).origin) return NextResponse.json({ error: "Request rejected" }, { status: 403 });
    if (Number(request.headers.get("content-length") || 0) > 12000) return NextResponse.json({ error: "Feedback is too long" }, { status: 413 });
    const raw = await readBoundedText(request, 12000);
    const body = JSON.parse(raw);
    if (body.website) return NextResponse.json({ ok: true });
    if (typeof body.slug !== "string" || !/^[a-f0-9]{32}$/.test(body.slug) || typeof body.title !== "string" || typeof body.body !== "string" || !["bug", "idea"].includes(body.kind)) throw new Error("Invalid feedback");
    // The reverse proxy must overwrite X-Real-IP; never retain raw visitor addresses.
    const address = request.headers.get("x-real-ip") || "direct";
    const key = createHash("sha256").update(`${process.env.ORIGIN_INTEGRATION_SECRET}:${address}`).digest("hex");
    limitLocalAction(`feedback:${key}`, 5, 3600000);
    await integrationBridge("feedback", { slug: body.slug, title: body.title, body: body.body, kind: body.kind });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Too many requests")) return NextResponse.json({ error: "Too many submissions. Try again in an hour." }, { status: 429 });
    return NextResponse.json({ error: "Unable to send feedback. Check your message or try again later." }, { status: error instanceof BodyTooLarge ? 413 : 400 });
  }
}
