import { randomBytes } from "node:crypto";

export interface PublicPage {
  html: string;
  nonce: string;
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char]!);
}

/** JSON that is safe inside a <script> element. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u" + "003c");
}

const STYLE = `
:root{color-scheme:dark;--app:#070707;--panel:#111;--card:#191919;--inset:#0f0f0f;--hairline:#333;--ink:#fcfcfc;--ink2:#fcfcfc99;--accent:#1084fe;--accent-ink:#fff;--focus:#459ffe;--danger:#ff5667;--success:#38d591}
@media (prefers-color-scheme:light){:root{color-scheme:light;--app:#f6f6f6;--panel:#fff;--card:#fff;--inset:#f2f2f2;--hairline:#e2e2e2;--ink:#0d0d0d;--ink2:#0d0d0d99;--danger:#d92d3f;--success:#0f8a5a}}
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:var(--app);color:var(--ink);font:14px/1.5 "Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
main{min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:32px 16px}
.wordmark{align-self:flex-start;font-weight:600;font-size:15px;letter-spacing:-.01em;color:var(--ink);text-decoration:none;margin-bottom:12vh}
.card{width:100%;max-width:400px;background:var(--panel);border:1px solid var(--hairline);border-radius:16px;padding:28px}
h1{font-size:22px;font-weight:600;letter-spacing:-.02em;margin:0 0 6px}
p{margin:0 0 16px;color:var(--ink2)}
.desc{white-space:pre-wrap}
form{display:flex;flex-direction:column;gap:12px}
label{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--ink2)}
input,textarea{font:inherit;color:var(--ink);background:var(--inset);border:1px solid var(--hairline);border-radius:10px;padding:9px 12px;outline:none;width:100%}
input:focus,textarea:focus{border-color:var(--focus)}
input[readonly]{opacity:.7}
textarea{resize:vertical;min-height:140px}
button{font:inherit;cursor:pointer}
.primary{display:inline-flex;justify-content:center;align-items:center;gap:6px;background:var(--accent);color:var(--accent-ink);border:0;border-radius:10px;padding:10px 14px;font-weight:600}
.primary:disabled{opacity:.6;cursor:default}
.link{background:none;border:0;color:var(--focus);padding:0}
.switch{margin:16px 0 0;text-align:center;font-size:13px}
.segmented{display:flex;gap:4px;background:var(--inset);border:1px solid var(--hairline);border-radius:10px;padding:3px}
.segmented button{flex:1;border:0;border-radius:8px;padding:6px;background:none;color:var(--ink2)}
.segmented button[aria-pressed=true]{background:var(--card);color:var(--ink);box-shadow:0 0 0 1px var(--hairline)}
.notice{border-radius:10px;padding:9px 12px;font-size:13px;margin:0}
.danger{background:color-mix(in srgb,var(--danger) 12%,transparent);color:var(--danger)}
.ok{color:var(--success)}
.honeypot{position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden}
[hidden]{display:none!important}
footer{margin-top:auto;padding-top:32px;font-size:12px;color:var(--ink2)}
`;

function shell(title: string, body: string, script?: string): PublicPage {
  const nonce = randomBytes(16).toString("base64");
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)} · Origin</title><style nonce="${nonce}">${STYLE}</style></head>
<body><main><a class="wordmark" href="/">Origin</a><section class="card">${body}</section><footer>Origin. A space to make things happen.</footer></main>${script ? `<script nonce="${nonce}">${script}</script>` : ""}</body></html>`;
  return { html, nonce };
}

export function unavailablePage(title: string, message: string): PublicPage {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a class="link" href="/">Open Origin</a>`);
}

const JOIN_SCRIPT = `
const cfg = JSON.parse(document.getElementById("cfg").textContent);
const $ = (id) => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
let signup = false;
const post = async (body) => {
  const response = await fetch("/api/origin/public/join/" + encodeURIComponent(cfg.token), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Something went wrong. Try again.");
  return result;
};
const done = (result) => {
  store.set("origin-cloud-url", result.url);
  store.set("origin-cloud-session", result.sessionToken);
  location.replace("/");
};
const fail = (el, error) => { el.textContent = error.message; el.hidden = false; };
const setMode = (next) => {
  signup = next;
  $("name-row").hidden = !signup;
  $("name").required = signup;
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("password").minLength = signup ? 10 : 0;
  $("password").placeholder = signup ? "At least 10 characters" : "Your password";
  $("submit").textContent = signup ? "Create account and join" : "Sign in and join";
  $("switch-text").textContent = signup ? "Already have an Origin account?" : "New to Origin?";
  $("switch").textContent = signup ? "Sign in" : "Create an account";
  $("error").hidden = true;
};
$("switch").addEventListener("click", () => setMode(!signup));
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("submit"); button.disabled = true; $("error").hidden = true;
  try { done(await post({ mode: signup ? "signup" : "signin", email: $("email").value, password: $("password").value, name: $("name").value })); }
  catch (error) { fail($("error"), error); button.disabled = false; }
});
$("other").addEventListener("click", () => { $("current").hidden = true; $("form-wrap").hidden = false; });
$("join-current").addEventListener("click", async () => {
  const button = $("join-current"); button.disabled = true;
  try { done(await post({ mode: "session", sessionToken: store.get("origin-cloud-session") })); }
  catch (error) { fail($("current-error"), error); button.disabled = false; }
});
const saved = store.get("origin-cloud-session");
if (saved) post({ mode: "me", sessionToken: saved }).then((me) => {
  $("current-email").textContent = me.email; $("current").hidden = false; $("form-wrap").hidden = true;
}).catch(() => {});
setMode(false);
`;

export function joinPage(invite: { token: string; name: string; role: string; email: string | null }): PublicPage {
  const email = invite.email
    ? `<input id="email" type="email" autocomplete="email" value="${escapeHtml(invite.email)}" readonly required>`
    : `<input id="email" type="email" autocomplete="email" required maxlength="254" placeholder="you@company.com">`;
  const body = `<h1>Join ${escapeHtml(invite.name)}</h1>
<p>You were invited as ${escapeHtml(invite.role)}. Sign in to Origin, or create your account, to accept.</p>
<div id="current" hidden><p>Signed in as <strong id="current-email"></strong>.</p><p id="current-error" class="notice danger" role="alert" hidden></p>
<form><button id="join-current" type="button" class="primary">Join workspace</button></form><p class="switch"><button id="other" type="button" class="link">Use a different account</button></p></div>
<div id="form-wrap"><form id="form">
<label id="name-row" hidden>Your name<input id="name" autocomplete="name" maxlength="100" placeholder="Alex Smith"></label>
<label>Email${email}</label>
<label>Password<input id="password" type="password" required maxlength="128"></label>
<p id="error" class="notice danger" role="alert" hidden></p>
<button id="submit" type="submit" class="primary">Sign in and join</button>
</form><p class="switch"><span id="switch-text"></span> <button id="switch" type="button" class="link"></button></p></div>
<script type="application/json" id="cfg">${scriptJson({ token: invite.token })}</script>`;
  return shell(`Join ${invite.name}`, body, JOIN_SCRIPT);
}

const FEEDBACK_SCRIPT = `
const cfg = JSON.parse(document.getElementById("cfg").textContent);
const $ = (id) => document.getElementById(id);
let kind = "idea";
for (const button of document.querySelectorAll("[data-kind]")) button.addEventListener("click", () => {
  kind = button.dataset.kind;
  for (const other of document.querySelectorAll("[data-kind]")) other.setAttribute("aria-pressed", String(other === button));
});
$("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = $("submit"); button.disabled = true; $("error").hidden = true;
  try {
    const response = await fetch("/api/origin/public/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug: cfg.slug, kind, title: $("title").value, body: $("body").value, website: $("website").value }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Could not send feedback");
    $("form-wrap").hidden = true; $("sent").hidden = false;
  } catch (error) { $("error").textContent = error.message; $("error").hidden = false; }
  finally { button.disabled = false; }
});
$("again").addEventListener("click", () => { $("title").value = ""; $("body").value = ""; $("sent").hidden = true; $("form-wrap").hidden = false; });
`;

export function feedbackPage(portal: { slug: string; title: string; description: string }): PublicPage {
  const body = `<div id="form-wrap"><h1>${escapeHtml(portal.title)}</h1>${portal.description ? `<p class="desc">${escapeHtml(portal.description)}</p>` : ""}
<form id="form">
<div class="segmented" role="group" aria-label="Kind"><button type="button" data-kind="idea" aria-pressed="true">Idea</button><button type="button" data-kind="bug" aria-pressed="false">Bug</button></div>
<label>Title<input id="title" required maxlength="180"></label>
<label>Details<textarea id="body" required maxlength="8000" rows="7"></textarea></label>
<label class="honeypot" aria-hidden="true">Website<input id="website" tabindex="-1" autocomplete="off"></label>
<p id="error" class="notice danger" role="alert" hidden></p>
<button id="submit" type="submit" class="primary">Send feedback</button>
</form></div>
<div id="sent" hidden><h1 class="ok">Thank you.</h1><p>Your feedback has been sent to the team.</p><button id="again" type="button" class="link">Send another</button></div>
<script type="application/json" id="cfg">${scriptJson({ slug: portal.slug })}</script>`;
  return shell(portal.title, body, FEEDBACK_SCRIPT);
}
