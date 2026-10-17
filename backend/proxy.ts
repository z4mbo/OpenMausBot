import { NextResponse, type NextRequest } from "next/server";
import { originCsp } from "./lib/origin-csp";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = originCsp(process.env, nonce, "next");
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export const config = { matcher: ["/((?!api|_next/static|_next/image|favicon.ico|excalidraw).*)"] };
