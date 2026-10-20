import assert from "node:assert/strict";
import { test } from "node:test";
import { convexSiteOrigin, relayPage } from "./pages-proxy.ts";

test("pages are served by the Convex HTTP origin paired with the deployment", () => {
  assert.equal(convexSiteOrigin({ NEXT_PUBLIC_CONVEX_URL: "https://wry-fly-446.eu-west-1.convex.cloud" }), "https://wry-fly-446.eu-west-1.convex.site");
  assert.equal(convexSiteOrigin({ NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" }), "http://127.0.0.1:3211");
  assert.equal(convexSiteOrigin({ ORIGIN_CONVEX_SITE_URL: "https://pages.example/", NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3210" }), "https://pages.example");
  assert.equal(convexSiteOrigin({}), null);
});

test("the relay keeps the page's headers and its relative redirect, and refuses odd addresses", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const send = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return init.method === "POST"
      ? new Response(null, { status: 303, headers: { location: "/p/acme/waitlist?sent=1#lead" } })
      : new Response("<!doctype html>page", { headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'", "set-cookie": "x=1" } });
  }) as typeof fetch;
  const env = { NEXT_PUBLIC_CONVEX_URL: "https://dep.convex.cloud" };
  const page = await relayPage(new Request("https://origin.example/p/acme/waitlist?form=invalid"), { site: "acme", page: "waitlist" }, env, send);
  assert.equal(calls[0]!.url, "https://dep.convex.site/p/acme/waitlist?form=invalid");
  assert.equal(page.headers.get("content-security-policy"), "default-src 'none'");
  assert.equal(page.headers.get("set-cookie"), null);
  assert.equal(await page.text(), "<!doctype html>page");
  const post = await relayPage(new Request("https://origin.example/p/acme/waitlist", { method: "POST", body: "email=a%40b.c" }), { site: "acme", page: "waitlist" }, env, send);
  assert.equal(post.status, 303);
  assert.equal(post.headers.get("location"), "/p/acme/waitlist?sent=1#lead");
  assert.equal(calls[1]!.init.body, "email=a%40b.c");
  const odd = await relayPage(new Request("https://origin.example/p/x"), { site: "../admin", page: "x" }, env, send);
  assert.equal(odd.status, 404);
  assert.equal(calls.length, 2);
});
