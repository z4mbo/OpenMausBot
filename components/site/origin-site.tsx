"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { preload } from "react-dom";
import clsx from "clsx";
import {
  ArrowRight, ArrowUpRight, AtSign, Check, ChevronDown, CircleCheck, Copy, CornerDownRight, Flag, LockKeyhole, Megaphone, Menu, Mic, MonitorUp,
  PhoneOff, RotateCcw, Video, X,
} from "lucide-react";
import { bodyFont, displayFont, handFontUrl, monoFont } from "./fonts";
import { GITHUB_URL, GitHubMark, githubDoc, useInView, usePrefersReducedMotion } from "./primitives";
import { WorkspaceDemo } from "./workspace-demo";
import { Journey } from "./journey";
import st from "./site.module.css";

const HOST = "your-origin.example";

export function OriginSite() {
  preload(handFontUrl, { as: "font", type: "font/woff2", crossOrigin: "anonymous" });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.setAttribute("data-in", "");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -10% 0px" });
    document.querySelectorAll("[data-reveal]").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  return (
    <div className={clsx(st.site, ready && st.ready, displayFont.variable, bodyFont.variable, monoFont.variable)} style={{ "--font-hand": "OriginHand" } as CSSProperties}>
      <a className={st.skip} href="#main">Skip to content</a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Journey />
        <Everything />
        <OpenSource />
        <Questions />
        <Closing />
      </main>
      <SiteFooter />
    </div>
  );
}

/* ---------------------------------------------------------------- header */

const navLinks = [
  ["#workflow", "How it works"],
  ["#everything", "Product"],
  ["#open-source", "Open source"],
  ["#questions", "FAQ"],
] as const;

function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 12);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  return (
    <header className={clsx(st.header, (scrolled || open) && st.scrolled)} onKeyDown={event => { if (event.key === "Escape" && open) { setOpen(false); document.getElementById("site-menu-toggle")?.focus(); } }}>
      <nav className={st.nav} aria-label="Main">
        <Link className={st.brand} href="/" aria-label="Origin home">Origin</Link>
        <div className={st.navLinks}>{navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</div>
        <div className={st.navActions}>
          <a className={st.navGithub} href={GITHUB_URL} target="_blank" rel="noreferrer" aria-label="Origin on GitHub"><GitHubMark size={17} /></a>
          <Link className={st.signIn} href="/login">Sign in</Link>
          <a className={clsx(st.button, st.small)} href="#open-source">Self-host<ArrowRight size={15} /></a>
          <button id="site-menu-toggle" type="button" className={st.menuToggle} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>{open ? <X size={20} /> : <Menu size={20} />}</button>
        </div>
      </nav>
      {open && (
        <div id="site-menu" className={st.mobileMenu}>
          {navLinks.map(([href, label]) => <a key={href} href={href} onClick={() => setOpen(false)}>{label}<ArrowRight size={16} /></a>)}
          <div><Link className={clsx(st.button, st.ghost)} href="/login">Sign in</Link><a className={st.button} href="#open-source" onClick={() => setOpen(false)}>Self-host<ArrowRight size={16} /></a></div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ hero */

function Word({ index, children }: { index: number; children: ReactNode }) {
  return <span className={st.word} style={{ "--i": index } as CSSProperties}>{children}</span>;
}

function Hero() {
  return (
    <section className={st.hero} aria-labelledby="hero-title">
      <div className={st.heroInner}>
        <a className={st.pill} href={GITHUB_URL} target="_blank" rel="noreferrer">
          <span className={st.pillDot} />Open-source public beta<span className={st.pillSep} />MIT licensed<ArrowUpRight size={14} />
        </a>
        <h1 id="hero-title" className={st.headline}>
          <span className={st.line}><Word index={0}>Where</Word>{" "}<Word index={1}>your</Word>{" "}<Word index={2}>team&apos;s</Word></span>
          <span className={st.line}><Word index={3}>work</Word>{" "}<Word index={4}>comes</Word>{" "}<Word index={5}>together.</Word></span>
        </h1>
        <div className={st.ctas}>
          <a className={clsx(st.button, st.large)} href="#open-source">Run it yourself<ArrowRight size={17} /></a>
          <a className={clsx(st.button, st.large, st.ghost)} href={GITHUB_URL} target="_blank" rel="noreferrer"><GitHubMark size={16} />View on GitHub</a>
        </div>
        <ul className={st.proof} aria-label="Highlights">
          <li>MIT licensed</li>
          <li>Self-hostable</li>
          <li>Claude &amp; Codex via MCP</li>
        </ul>
        <div className={st.demoWrap}>
          <WorkspaceDemo />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------ everything */

function Everything() {
  return (
    <section id="everything" className={st.everything} aria-labelledby="everything-title">
      <div className={st.sectionHead} data-reveal>
        <p className={st.eyebrow}>Around the work</p>
        <h2 id="everything-title">Everything else your team reaches for.</h2>
        <p className={st.lede}>No second app for calls, no third for secrets. The rest of the workspace sits one click from the board.</p>
      </div>
      <div className={st.bento}>
        <Tile className={st.wide} title="An inbox that's yours." body="Assigned issues, mentions, and comments in one list. Switch to the week or month calendar to see what's due, and snooze what can wait." visual={<InboxVisual />} />
        <Tile title="Calls that stay open." body="Audio, video, and screen sharing with your own TURN relay. Switch to Draw without hanging up." visual={<CallVisual />} delay={1} />
        <Tile title="A vault for shared secrets." body="Keep credentials with the project. Values are encrypted in your browser with the vault passphrase before they're saved." visual={<VaultVisual />} />
        <Tile title="Feedback from outside." body="Open a public form for any project. Triage what comes in privately, then turn the good ideas into assigned issues." visual={<FeedbackVisual />} delay={1} />
        <Tile title="Finished work, out of the way." body="Completed issues leave the board, not the project. They're grouped by the column they finished in, ready to restore." visual={<CompletedVisual />} delay={2} />
      </div>
    </section>
  );
}

function Tile({ title, body, visual, className, delay = 0 }: { title: string; body: string; visual: ReactNode; className?: string; delay?: number }) {
  return (
    <article className={clsx(st.tile, className)} data-reveal style={{ "--d": delay } as CSSProperties}>
      <div className={st.visual} aria-hidden="true">{visual}</div>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function InboxVisual() {
  const days = [["Mon", 28], ["Tue", 29], ["Wed", 30], ["Thu", 1], ["Fri", 2]] as const;
  const pills: Record<number, [string, string]> = { 29: ["Ship navigation", "high"], 1: ["Type scale", "low"], 2: ["Homepage", "medium"] };
  return (
    <div className={st.inboxVis}>
      <div className={st.calendar}>
        {days.map(([day, date], index) => (
          <div key={date} className={clsx(date === 30 && st.today)}>
            <span>{day}</span><strong>{date}</strong>
            {pills[date] && <em className={st[pills[date][1]]} style={{ "--d": index } as CSSProperties}><Flag size={9} />{pills[date][0]}</em>}
          </div>
        ))}
      </div>
      <div className={st.mention}>
        <span className={st.mentionIcon}><AtSign size={13} /></span>
        <p><strong>Rin mentioned you</strong> in ORI-G4KR<small>“@alex two steps is plenty. Ship it?”</small></p>
        <time>2m</time>
      </div>
    </div>
  );
}

function CallVisual() {
  return (
    <div className={st.callVis}>
      <div className={st.callPeople}>
        {[["S", "cyan"], ["R", "violet"], ["A", "lime"]].map(([initial, tone], index) => (
          <span key={initial} className={clsx(st.callAvatar, st[tone], index === 0 && st.talking)}>{initial}</span>
        ))}
      </div>
      <div className={st.wave}>{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ "--k": (index * 37) % 11 } as CSSProperties} />)}</div>
      <div className={st.callBar}><span><Mic size={13} /></span><span><Video size={13} /></span><span><MonitorUp size={13} /></span><span className={st.hang}><PhoneOff size={13} /></span></div>
    </div>
  );
}

const CIPHERS = ["U2FsdGVkX19q9Lx0Pm4", "k3VfR0dNQ1pZ8wq1Tz", "YbN2c1Qx7Hq0LmR4sW"];
const GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";

function VaultVisual() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  const [values, setValues] = useState(CIPHERS);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!inView || reduced) return;
    let frame = 0;
    const timer = window.setInterval(() => {
      frame += 1;
      setValues(CIPHERS.map((cipher, row) => cipher.split("").map((char, index) => index < frame - row * 3 ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]).join("")));
      if (frame > CIPHERS[0].length + 8) window.clearInterval(timer);
    }, 55);
    return () => window.clearInterval(timer);
  }, [inView, reduced, run]);
  return (
    <div ref={ref} className={st.vaultVis} onMouseEnter={() => setRun(value => value + 1)}>
      <div className={st.vaultHead}><LockKeyhole size={14} />Website vault<span>AES-256-GCM</span></div>
      {["STAGING_DATABASE_URL", "ANALYTICS_WRITE_KEY", "SMTP_PASSWORD"].map((name, index) => (
        <div key={name} className={st.secret}><code>{name}</code><span>{values[index]}…</span></div>
      ))}
    </div>
  );
}

function FeedbackVisual() {
  return (
    <div className={st.feedbackVis}>
      <div className={st.form}>
        <span className={st.formLabel}><Megaphone size={12} />Suggest something for Website</span>
        <p className={st.field}>Dark mode for the public roadmap<i /></p>
        <span className={st.submit}>Send feedback</span>
      </div>
      <CornerDownRight className={st.feedbackArrow} size={18} />
      <div className={st.feedbackCard}><code>ORI-P3LM</code><strong>Dark mode for the public roadmap</strong><span><i />Idea</span></div>
    </div>
  );
}

function CompletedVisual() {
  const groups = [
    ["Todo", [["ORI-G1ZB", "Set up the project workspace"], ["ORI-F8QA", "Write the invite email"]]],
    ["In progress", [["ORI-G4KR", "Review the onboarding flow"]]],
  ] as const;
  let row = 0;
  return (
    <div className={st.completedVis}>
      {groups.map(([column, items]) => (
        <div key={column}>
          <span className={st.groupLabel}>{column}<small>{items.length}</small></span>
          {items.map(([code, title]) => (
            <div key={code} className={st.doneRow} style={{ "--d": row++ } as CSSProperties}>
              <CircleCheck size={14} /><code>{code}</code><strong>{title}</strong>{code === "ORI-G1ZB" && <em><RotateCcw size={11} />Restore</em>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ----------------------------------------------------------- open source */

const setup = [
  ["git clone https://github.com/z4mbo/origin-workspace.git"],
  ["cd origin-workspace"],
  ["npm ci --legacy-peer-deps"],
  ["cp .env.example .env.local"],
  ["npx convex dev"],
  ["npm run dev", "second terminal"],
] as const;

function OpenSource() {
  const [copied, setCopied] = useState(false);
  return (
    <section id="open-source" className={st.openSource} aria-labelledby="open-source-title">
      <div className={st.sectionHead} data-reveal>
        <p className={st.eyebrow}>Open source</p>
        <h2 id="open-source-title">Run your own Origin.</h2>
        <p className={st.lede}>MIT licensed and self-hosted: run the Node server on your own machine with a Convex deployment. There is no shared hosted service, so your workspace stays on infrastructure you control.</p>
      </div>
      <div className={st.osGrid}>
        <div className={st.codeBlock} data-reveal>
          <div className={st.codeHead}>
            <span>Run it locally</span>
            <button type="button" onClick={async () => { try { await navigator.clipboard.writeText(setup.map(([line]) => line).join("\n")); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch { setCopied(false); } }}>
              {copied ? <><Check size={13} />Copied</> : <><Copy size={13} />Copy all</>}
            </button>
          </div>
          <pre>{setup.map(([line, note]) => <span key={line} className={st.codeLine}><b>$</b>{line}{note && <em>  # {note}</em>}{"\n"}</span>)}</pre>
          <p className={st.codeNote}>Node.js 24+ and a Convex deployment. No OpenAI or Anthropic key required. Open <code>localhost:3000/signup</code> to create the first workspace.</p>
          <div className={st.osLinks}>
            <a href={githubDoc("deploy/README.md")} target="_blank" rel="noreferrer">Self-hosting guide<ArrowUpRight size={14} /></a>
            <a href={githubDoc("CONTRIBUTING.md")} target="_blank" rel="noreferrer">Contributing<ArrowUpRight size={14} /></a>
            <a href={githubDoc("SECURITY.md")} target="_blank" rel="noreferrer">Security<ArrowUpRight size={14} /></a>
          </div>
        </div>
        <figure className={st.arch} data-reveal style={{ "--d": 1 } as CSSProperties}>
          <figcaption>What runs where</figcaption>
          <div className={st.archBrowser}><strong>Browser</strong><span>Your team, on any device</span></div>
          <svg className={st.archLines} viewBox="0 0 300 60" preserveAspectRatio="none" aria-hidden="true">
            <path d="M150 0 C150 30, 50 30, 50 60" /><path d="M150 0 L150 60" /><path d="M150 0 C150 30, 250 30, 250 60" className={st.dashed} />
          </svg>
          <div className={st.archRow}>
            <div><strong>Convex</strong><span>Board, drawings, feedback, accounts, project assets</span></div>
            <div><strong>Node server</strong><span>Next.js with SQLite for chat, calls, and integrations. GitHub OAuth, webhooks, and MCP.</span></div>
            <div className={st.optional}><strong>coturn</strong><span>Optional TURN relay for call media</span></div>
          </div>
          <ul className={st.stack}>{["Next.js", "React", "TypeScript", "Convex", "SQLite", "WebRTC", "Excalidraw", "Yjs"].map(item => <li key={item}>{item}</li>)}</ul>
        </figure>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- questions */

const questions = [
  ["Who can see my workspace?", "Only its members. Each workspace is private. A public feedback form shows only the title and description an admin chooses, never internal issues or submitted feedback."],
  ["Do I need GitHub?", "No. Issues, chat, calls, and drawing work on their own. Connect GitHub when you want linked issues and repositories. New repositories are private by default."],
  ["What can an AI client see?", "Projects, issues, members, and your issue inbox in the one workspace you authorize. Not chat messages, the vault, GitHub credentials, or code execution. Grants expire, and you can revoke them."],
  ["Does it work on my phone?", "Yes. Check issues, catch up on chat, and open the canvas from your mobile browser. Camera and screen sharing need HTTPS outside localhost."],
  ["What happens when an issue is done?", "It moves to the project's Completed view, grouped by the column it finished in. It doesn't take up a column or count toward open issues, and you can restore it anytime."],
] as const;

function Questions() {
  return (
    <section id="questions" className={st.questions} aria-labelledby="questions-title">
      <div data-reveal>
        <p className={st.eyebrow}>FAQ</p>
        <h2 id="questions-title">Questions, answered.</h2>
      </div>
      <div className={st.faqList} data-reveal style={{ "--d": 1 } as CSSProperties}>
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}<ChevronDown size={18} /></summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- closing */

const slugs = ["your-team", "studio", "night-shift", "garage-band", "field-notes"];

function SlugTyper() {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [length, setLength] = useState(slugs[0].length);
  const [deleting, setDeleting] = useState(false);
  const [ref, inView] = useInView<HTMLSpanElement>({ once: false });
  useEffect(() => {
    if (reduced || !inView) return;
    const slug = slugs[index];
    let delay = deleting ? 45 : 85;
    if (!deleting && length === slug.length) delay = 1900;
    const timer = window.setTimeout(() => {
      if (!deleting && length === slug.length) setDeleting(true);
      else if (deleting && length === 0) { setDeleting(false); setIndex((index + 1) % slugs.length); }
      else setLength(length + (deleting ? -1 : 1));
    }, delay);
    return () => window.clearTimeout(timer);
  }, [reduced, inView, index, length, deleting]);
  return <span ref={ref} className={st.slug}>{slugs[index].slice(0, length)}<i /></span>;
}

function Closing() {
  const [ref, inView] = useInView<HTMLHeadingElement>({ rootMargin: "0px 0px -15% 0px" });
  return (
    <section className={st.closing} aria-labelledby="closing-title">
      <p className={st.closingKicker} data-reveal>Clone it. Host it. Invite your team.</p>
      <h2 id="closing-title" ref={ref} className={clsx(st.wordmark, inView && st.wordmarkIn)} aria-label="Origin">
        <span className={st.ringO} aria-hidden="true">
          <i /><i /><i />
          <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="38" /><circle cx="50" cy="50" r="17" /></svg>
        </span>
        {"rigin".split("").map((letter, index) => <span key={index} aria-hidden="true" style={{ "--i": index } as CSSProperties}>{letter}</span>)}
      </h2>
      <div className={st.closingFoot} data-reveal>
        <p className={st.address}><span>{HOST}/</span><SlugTyper /><Check size={18} /></p>
        <div className={st.ctas}>
          <a className={clsx(st.button, st.large)} href="#open-source">Run it yourself<ArrowRight size={17} /></a>
          <a className={clsx(st.button, st.large, st.ghost)} href={GITHUB_URL} target="_blank" rel="noreferrer"><GitHubMark size={16} />View on GitHub</a>
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- footer */

function SiteFooter() {
  return (
    <footer className={st.footer}>
      <div className={st.footTop}>
        <div className={st.footBrand}>
          <Link className={st.brand} href="/" aria-label="Origin home">Origin</Link>
          <p>A place to make things together.</p>
        </div>
        <nav aria-label="Product"><strong>Product</strong><a href="#workflow">How it works</a><a href="#everything">Workspace</a><a href="#questions">FAQ</a></nav>
        <nav aria-label="Resources"><strong>Resources</strong><a href={GITHUB_URL} target="_blank" rel="noreferrer">GitHub</a><a href={githubDoc("deploy/README.md")} target="_blank" rel="noreferrer">Self-hosting</a><a href={githubDoc("README.md#connect-ai-agents-mcp")} target="_blank" rel="noreferrer">Connect an AI client</a><a href={githubDoc("CONTRIBUTING.md")} target="_blank" rel="noreferrer">Contributing</a><a href={githubDoc("SECURITY.md")} target="_blank" rel="noreferrer">Security</a></nav>
        <nav aria-label="Account"><strong>Account</strong><Link href="/login">Sign in</Link></nav>
      </div>
      <div className={st.footBottom}><span>© 2026 Origin contributors · MIT License</span><span>Demo content on this page is synthetic.</span></div>
    </footer>
  );
}
