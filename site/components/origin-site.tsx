"use client";

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import clsx from "clsx";
import {
  ArrowRight, Bot, Check, ChevronDown, Cloud, FileImage, FolderGit2, GitPullRequest, Inbox, KeyRound, Laptop, ListTodo, Menu, MessageSquareHeart,
  MessagesSquare, PenTool, Phone, ShieldAlert, UsersRound, Vault, X,
} from "lucide-react";
import { bodyFont } from "@/lib/fonts";
import { AgentAvatar, AppleLogo, MAC_ARM_DOWNLOAD_URL, MAC_INTEL_DOWNLOAD_URL, TEAM, WINDOWS_DOWNLOAD_URL, WindowsLogo, usePlatform, useOriginSession, type Platform } from "./brand";
import { OriginLogo } from "./origin-logo";
import { useInView, usePageVisible, useReducedMotion, useReveal } from "./motion";
import { PrDemo, phaseOf, usePrDemo } from "./pr-demo";
import st from "./site.module.css";

const order = (index: number) => ({ "--i": index }) as CSSProperties;

export function SiteFrame({ children, signedIn, minimal = false }: { children: ReactNode; signedIn?: boolean; minimal?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useReveal(root);
  return (
    <div ref={root} className={clsx(st.site, bodyFont.variable)}>
      <a className={st.skip} href="#main">Skip to content</a>
      <SiteHeader signedIn={signedIn} minimal={minimal} />
      {children}
      <SiteFooter />
    </div>
  );
}

export function OriginSite() {
  const session = useOriginSession();
  const signedIn = Boolean(session.user);
  return (
    <SiteFrame signedIn={signedIn}>
      <main id="main">
        <Hero signedIn={signedIn} />
        <Structure />
        <IssueToPr />
        <Team />
        <Together />
        <Anywhere />
        <section id="download" className={clsx(st.section, st.downloadSection)} aria-labelledby="download-title">
          <DownloadCard name={session.user?.name} />
        </section>
        <Questions />
      </main>
    </SiteFrame>
  );
}

const navLinks = [
  ["/#how", "How it works"],
  ["/#team", "Agents"],
  ["/#together", "Workspace"],
  ["/#questions", "FAQ"],
] as const;

function SiteHeader({ signedIn, minimal }: { signedIn?: boolean; minimal: boolean }) {
  const [open, setOpen] = useState(false);
  const platform = usePlatform();
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      document.getElementById("site-menu-toggle")?.focus();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const account = signedIn ? "Account" : "Sign in";
  return (
    <header className={st.header}>
      <nav className={st.nav} aria-label="Main">
        <Link className={st.brand} href="/" aria-label="Origin home"><OriginLogo size={28} /><span>Origin</span></Link>
        {!minimal && <div className={st.navLinks}>{navLinks.map(([href, label]) => <a key={href} href={href}>{label}</a>)}</div>}
        <div className={st.navActions}>
          <Link className={st.textLink} href="/login">{account}</Link>
          {platform === "mac"
            ? <a className={clsx(st.button, st.small)} href={MAC_ARM_DOWNLOAD_URL}><AppleLogo size={13} />Download</a>
            : <a className={clsx(st.button, st.small)} href={WINDOWS_DOWNLOAD_URL}><WindowsLogo size={13} />Download</a>}
          {!minimal && (
            <button id="site-menu-toggle" type="button" className={st.menuToggle} aria-expanded={open} aria-controls="site-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          )}
        </div>
      </nav>
      {open && (
        <nav id="site-menu" className={st.mobileMenu} aria-label="Mobile navigation">
          {navLinks.map(([href, label], index) => <a key={href} href={href} style={order(index)} onClick={() => setOpen(false)}>{label}<ArrowRight size={16} /></a>)}
          <Link href="/login" style={order(navLinks.length)} onClick={() => setOpen(false)}>{account}<ArrowRight size={16} /></Link>
        </nav>
      )}
    </header>
  );
}

function WindowsButton({ large = false, ghost = false }: { large?: boolean; ghost?: boolean }) {
  return <a className={clsx(st.button, large && st.large, ghost && st.ghost)} href={WINDOWS_DOWNLOAD_URL}><WindowsLogo />Download for Windows</a>;
}

function MacButton({ large = false, ghost = false }: { large?: boolean; ghost?: boolean }) {
  return <a className={clsx(st.button, large && st.large, ghost && st.ghost)} href={MAC_ARM_DOWNLOAD_URL}><AppleLogo />Download for Mac</a>;
}

export function DownloadButtons({ platform }: { platform: Platform }) {
  return (
    <div className={st.downloads}>
      {platform === "mac" ? <><MacButton large /><WindowsButton large ghost /></> : <><WindowsButton large /><MacButton large ghost /></>}
    </div>
  );
}

const HEADLINE = "Every project gets a team of agents that ships.";

function Hero({ signedIn }: { signedIn: boolean }) {
  const platform = usePlatform();
  return (
    <section className={st.hero} aria-labelledby="hero-title">
      <div className={st.heroText}>
        <span className={clsx(st.heroLogo, st.enter)} style={order(0)}><OriginLogo size={64} /></span>
        <p className={clsx(st.eyebrow, st.enter)} style={order(1)}><span className={st.dot} />The Origin desktop app is out for Windows and Mac</p>
        <h1 id="hero-title">
          {HEADLINE.split(" ").map((word, index) => (
            <Fragment key={index}>{index > 0 && " "}<span className={st.word} style={{ "--w": index } as CSSProperties}>{word}</span></Fragment>
          ))}
        </h1>
        <p className={clsx(st.lede, st.enter)} style={order(4)}>
          Origin is where people and AI agents work side by side. Each project is led by a Chief with its own team that picks up issues
          and opens pull requests, running on your machine.
        </p>
        <div className={clsx(st.ctas, st.enter)} style={order(5)}>
          {platform === "mac" ? <MacButton large /> : <WindowsButton large />}
          <Link className={clsx(st.button, st.large, st.ghost, st.arrow)} href="/login">{signedIn ? "Your account" : "Sign in"}<ArrowRight size={17} /></Link>
        </div>
        <ul className={st.avatarRow} aria-label="A project's team">
          <li style={order(0)}><AgentAvatar id="chief" size={34} label="Chief" /></li>
          {TEAM.map((agent, index) => <li key={agent.id} style={order(index + 1)}><AgentAvatar id={agent.id} size={34} label={agent.name} /></li>)}
        </ul>
      </div>
      <figure className={clsx(st.window, st.heroShot)}>
        <picture>
          <source media="(max-width: 640px)" srcSet="/landing/issues-crop.webp" />
          <img src="/landing/issues.webp" srcSet="/landing/issues-960.webp 960w, /landing/issues.webp 1600w" sizes="(max-width: 1240px) 94vw, 1160px"
            width={1600} height={1000} fetchPriority="high" decoding="async"
            alt="The Issues board of the Website relaunch project in Origin: issues in Draft, Todo and In progress columns, with the workspace and its projects in the sidebar." />
        </picture>
      </figure>
    </section>
  );
}

function SectionHead({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className={st.sectionHead} data-reveal="">
      <p className={st.eyebrow}>{eyebrow}</p>
      <h2 id={id}>{title}</h2>
      {children && <p className={st.lede}>{children}</p>}
    </div>
  );
}

const PROJECTS = [
  { name: "Website relaunch", color: "#ff6b3d", team: ["researcher", "product-manager", "designer", "developer", "marketer", "copywriter"] },
  { name: "Mobile app", color: "#2f80ed", team: ["product-manager", "designer", "developer"] },
  { name: "Brand refresh", color: "#9b51e0", team: ["designer", "marketer", "copywriter"] },
] as const;

function useCycle(length: number, ms: number, active: boolean) {
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % length), ms);
    return () => window.clearInterval(timer);
  }, [active, length, ms]);
  return index;
}

function Structure() {
  const tree = useRef<HTMLOListElement>(null);
  const inView = useInView(tree);
  const visible = usePageVisible();
  const reduced = useReducedMotion();
  const active = useCycle(PROJECTS.length, 2600, inView && visible && !reduced);
  const project = PROJECTS[active];
  const nameOf = (id: string) => TEAM.find(agent => agent.id === id)?.name ?? id;
  return (
    <section id="how" className={st.section} aria-labelledby="how-title">
      <SectionHead id="how-title" eyebrow="How Origin is organized" title="Workspaces hold projects. Projects have teams.">
        Sign in once and your workspaces, projects and issues follow your account. Each project has a Chief that plans the work and hands it to the right specialist.
      </SectionHead>
      <ol ref={tree} className={st.tree}>
        <li className={st.treeCard} data-reveal="" style={order(0)}>
          <span className={st.step} aria-hidden="true">1</span>
          <h3>Workspace</h3>
          <p>Your company or team: members, chat, calls, a shared canvas and one inbox.</p>
          <div className={st.chips}><span className={clsx(st.chip, st.chipOn)}><span className={st.workspaceIcon} aria-hidden="true">N</span>Northwind</span></div>
        </li>
        <li className={st.treeCard} data-reveal="" style={order(1)}>
          <span className={st.step} aria-hidden="true">2</span>
          <h3>Projects</h3>
          <p>Each with issues, assets, a vault, a repo and feedback, and a Chief in charge.</p>
          <div className={st.chips}>
            {PROJECTS.map((item, index) => (
              <span key={item.name} className={clsx(st.chip, index === active && st.chipOn)}>
                <span className={st.projectDot} style={{ background: item.color }} aria-hidden="true" />{item.name}
              </span>
            ))}
          </div>
        </li>
        <li className={st.treeCard} data-reveal="" style={order(2)}>
          <span className={st.step} aria-hidden="true">3</span>
          <h3>Agent team</h3>
          <p>A Chief and the specialists the project needs. They take issues, talk to each other and report back to you.</p>
          <div className={st.miniTeam} key={project.name}>
            <span className={st.teamOf}><span className={st.projectDot} style={{ background: project.color }} aria-hidden="true" />{project.name}</span>
            <span className={st.faces}>
              <span style={order(0)}><AgentAvatar id="chief" size={30} label="Chief" /></span>
              {project.team.map((id, index) => <span key={id} style={order(index + 1)}><AgentAvatar id={id} size={30} label={nameOf(id)} /></span>)}
            </span>
          </div>
        </li>
      </ol>
    </section>
  );
}

function IssueToPr() {
  const demo = usePrDemo();
  const phase = phaseOf(demo.step);
  const steps = [
    { icon: <ListTodo size={18} />, title: "Write the issue", body: "Or ask the Product Manager to. Priority, due date and labels sit on the board everyone sees." },
    { icon: <Bot size={18} />, title: "The Chief hands it out", body: "It picks the agents, who move the issue to In progress and work in the project's repo on their own branch." },
    { icon: <GitPullRequest size={18} />, title: "Review the pull request", body: "The agent opens a PR that names the issue, the Chief reviews it against the brief and you merge." },
  ];
  return (
    <section className={clsx(st.section, st.split)} aria-labelledby="pr-title">
      <div>
        <SectionHead id="pr-title" eyebrow="Issue, agent, pull request" title="Assign an issue. Get a pull request back." />
        <ol className={st.steps}>
          {steps.map((step, index) => (
            <li key={step.title} data-reveal="" style={order(index)} data-active={phase === index ? "" : undefined}>
              <span className={st.stepIcon} aria-hidden="true">{step.icon}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p></div>
            </li>
          ))}
        </ol>
        <p className={st.note} data-reveal="" style={order(3)}><Check size={15} aria-hidden="true" />Agents ask before anything they can&apos;t undo.</p>
      </div>
      <div data-reveal="" style={order(1)}><PrDemo demo={demo} /></div>
    </section>
  );
}

function Team() {
  return (
    <section id="team" className={st.section} aria-labelledby="team-title">
      <SectionHead id="team-title" eyebrow="Meet the team" title="A Chief and six specialists for every project.">
        Start from the template team or build your own. Every agent has a face, a role and a chat you can open at any time.
      </SectionHead>
      <div className={st.teamGrid}>
        <article className={clsx(st.agent, st.chief)} data-reveal="">
          <AgentAvatar id="chief" size={52} />
          <div><h3>Chief</h3><p>Leads the project. Breaks goals into issues, assigns them, reviews the pull requests and keeps you posted.</p></div>
        </article>
        {TEAM.map((agent, index) => (
          <article key={agent.id} className={st.agent} data-reveal="" style={order(index % 3)}>
            <AgentAvatar id={agent.id} size={44} />
            <div><h3>{agent.name}</h3><p>{agent.job}</p></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Together() {
  const features = [
    { icon: <Inbox size={18} />, title: "Inbox", body: "Assignments, mentions and finished work in one list." },
    { icon: <MessagesSquare size={18} />, title: "Chat", body: "Talk with people and agents in the workspace or a project." },
    { icon: <Phone size={18} />, title: "Calls", body: "Get on a call with your team without leaving the app." },
    { icon: <PenTool size={18} />, title: "Draw", body: "A shared canvas for sketches, flows and plans." },
    { icon: <FileImage size={18} />, title: "Assets", body: "Files and images the project and its agents work from." },
    { icon: <Vault size={18} />, title: "Vault", body: "Shared secrets, encrypted before they are saved." },
    { icon: <FolderGit2 size={18} />, title: "Repo", body: "Connect a GitHub repository so issues and PRs stay linked." },
    { icon: <MessageSquareHeart size={18} />, title: "Feedback", body: "A public form per project. Turn good ideas into issues." },
  ];
  return (
    <section id="together" className={st.section} aria-labelledby="together-title">
      <SectionHead id="together-title" eyebrow="People and agents, together" title="One workspace for the whole team.">
        Invite teammates to a workspace or to a single project. Everyone sees the same board, and anyone can hand work to an agent.
      </SectionHead>
      <ul className={st.features}>
        {features.map((feature, index) => (
          <li key={feature.title} data-reveal="" style={order(index % 4)}><span className={st.featureIcon} aria-hidden="true">{feature.icon}</span><h3>{feature.title}</h3><p>{feature.body}</p></li>
        ))}
      </ul>
    </section>
  );
}

function Anywhere() {
  const places = [
    { icon: <Laptop size={20} />, title: "On your machine", body: "Agents run locally with the coding engines you already use, next to your files." },
    { icon: <UsersRound size={20} />, title: "On a teammate's machine", body: "Work with an agent that runs on another computer in your team." },
    { icon: <Cloud size={20} />, title: "On cloud computers", body: "Give long jobs a machine of their own so they keep going when your laptop sleeps." },
    { icon: <KeyRound size={20} />, title: "With your API keys", body: "Bring a key and choose the model per agent. You pay the provider directly." },
  ];
  return (
    <section className={st.section} aria-labelledby="anywhere-title">
      <SectionHead id="anywhere-title" eyebrow="Runs where you want" title="Your agents, on your computers." />
      <ul className={st.places}>
        {places.map((place, index) => <li key={place.title} data-reveal="" style={order(index)}><span className={st.placeIcon} aria-hidden="true">{place.icon}</span><h3>{place.title}</h3><p>{place.body}</p></li>)}
      </ul>
    </section>
  );
}

export function DownloadCard({ name, compact = false }: { name?: string; compact?: boolean }) {
  const platform = usePlatform();
  const title = name ? `You're signed in, ${name.split(" ")[0]}.` : platform === "mac" ? "Get Origin for Mac." : "Get Origin for Windows.";
  return (
    <div className={clsx(st.downloadCard, compact && st.compact)} data-reveal="">
      {!compact && <OriginLogo size={64} />}
      <h2 id="download-title">{title}</h2>
      <p>{name ? "Your workspaces live in the desktop app. Install it and sign in with the same email." : "Install the app, sign in with your Origin account and your workspaces are there."}</p>
      <DownloadButtons platform={platform} />
      <p className={st.fine}>Windows 10 and 11, 64-bit · macOS on Apple silicon (<a href={MAC_INTEL_DOWNLOAD_URL}>Intel build</a>). The app updates itself.</p>
      <p className={st.smartscreen}>
        <ShieldAlert size={15} aria-hidden="true" />
        <span>The apps aren&apos;t code-signed yet. On Windows, if SmartScreen stops the installer, choose <b>More info</b>, then <b>Run anyway</b>. On a Mac, right-click Origin, choose <b>Open</b>, then <b>Open</b> again.</span>
      </p>
    </div>
  );
}

function Questions() {
  const questions = [
    ["Do I need an account?", "Yes. Your Origin account holds your workspaces, projects and issues so the whole team sees the same thing. Sign in here or straight from the app."],
    ["Where does my code go?", "Agents work in the project's repository on the computer they run on. Origin keeps the plan: issues, comments, chat and links to pull requests."],
    ["Which AI models can agents use?", "The coding engines you already have installed, or any provider you hold an API key for. You choose per agent."],
    ["Can I bring my team?", "Yes. Workspace admins send invite links. Teammates open the link here, or paste it into the app after signing in."],
    ["Is there a Mac version?", "Yes. Download it for Apple silicon, or the Intel build from the download section."],
    ["What happened to the web dashboard?", "Origin now lives in the desktop app. Your workspaces and projects are the same, and invite links still work."],
  ] as const;
  return (
    <section id="questions" className={st.section} aria-labelledby="questions-title">
      <SectionHead id="questions-title" eyebrow="Questions" title="Good to know." />
      <div className={st.faq} data-reveal="">
        {questions.map(([question, answer]) => (
          <details key={question}>
            <summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary>
            <p>{answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className={st.footer}>
      <div className={st.footerInner}>
        <Link className={st.brand} href="/" aria-label="Origin home"><OriginLogo size={24} /><span>Origin</span></Link>
        <nav aria-label="Footer">
          <a href="/#download">Download</a>
          <Link href="/login">Sign in</Link>
          <Link href="/signup">Create account</Link>
        </nav>
        <p>No trackers, no ads.</p>
      </div>
    </footer>
  );
}
