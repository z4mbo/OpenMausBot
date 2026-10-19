"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import clsx from "clsx";
import { Check, GitMerge, GitPullRequest, Pause, Play } from "lucide-react";
import { AgentAvatar } from "./brand";
import { useInView, usePageVisible, useReducedMotion } from "./motion";
import st from "./pr-demo.module.css";

type Actor = "you" | "chief" | "developer" | "designer";

const EVENTS: { actor: Actor; name: string; body: ReactNode }[] = [
  { actor: "you", name: "Maya", body: <>created <b>ORI-42</b> Pricing page</> },
  { actor: "chief", name: "Chief", body: "Developer takes ORI-42. Designer reviews the layout." },
  { actor: "developer", name: "Developer", body: <code>git switch -c ori-42-pricing</code> },
  { actor: "designer", name: "Designer", body: "Layout checked at 375 and 1440 px." },
  { actor: "developer", name: "Developer", body: <>6 files changed, tests pass<span className={st.bar} aria-hidden="true"><i /></span></> },
  { actor: "developer", name: "Developer", body: <>opened pull request <b>#42</b></> },
  { actor: "chief", name: "Chief", body: "Reviewed #42 against the issue. Ready to merge." },
  { actor: "you", name: "Maya", body: <>merged <b>#42</b>. ORI-42 is done.</> },
];

const COLUMNS = ["Todo", "In progress", "Done"];
const LAST = EVENTS.length;
const HOLD_MS = [700, 1300, 1700, 1400, 1300, 1500, 1400, 1500, 3400];
const RESET_MS = 650;

/** Which of the three "Issue, agent, pull request" steps a demo step belongs to. */
export function phaseOf(step: number) {
  if (step === 0) return -1;
  if (step === 1) return 0;
  return step <= 5 ? 1 : 2;
}

export function usePrDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const inView = useInView(ref);
  const pageVisible = usePageVisible();
  const [paused, setPaused] = useState(false);
  const [running, setRunning] = useState(1);
  const step = reduced ? LAST : running;
  const playing = !reduced && !paused && inView && pageVisible;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => setRunning(current => (current === LAST ? 0 : current + 1)), running === 0 ? RESET_MS : HOLD_MS[running]);
    return () => window.clearTimeout(timer);
  }, [playing, running]);
  return { ref, step, paused, setPaused, reduced };
}

const columnOf = (step: number) => (step >= LAST ? 2 : step >= 2 ? 1 : 0);
const progressOf = (step: number) => (step >= 5 ? 1 : step === 4 ? 0.6 : step === 3 ? 0.25 : 0);

function Badge({ step }: { step: number }) {
  if (step >= LAST) return <span key="merged" className={clsx(st.badge, st.merged)}><GitMerge size={11} /><span className={st.badgeText}>Merged</span></span>;
  if (step === 7) return <span key="approved" className={clsx(st.badge, st.approved)}><Check size={11} /><span className={st.badgeText}>Approved</span></span>;
  if (step === 6) return <span key="open" className={clsx(st.badge, st.open)}><GitPullRequest size={11} />#42</span>;
  return null;
}

export function PrDemo({ demo }: { demo: ReturnType<typeof usePrDemo> }) {
  const { ref, step, paused, setPaused, reduced } = demo;
  const card = useRef<HTMLDivElement>(null);
  const column = columnOf(step);
  const previousColumn = useRef(column);
  useEffect(() => {
    if (previousColumn.current === column) return;
    const moved = column > previousColumn.current;
    previousColumn.current = column;
    if (!moved || reduced) return;
    card.current?.animate([{ rotate: "0deg", scale: "1" }, { rotate: "-2deg", scale: "1.04", offset: 0.45 }, { rotate: "0deg", scale: "1" }], { duration: 160, easing: "cubic-bezier(0.3, 0, 0.2, 1)" });
  }, [column, reduced]);
  const counts = [1 + Number(step === 1), Number(step >= 2 && step < LAST), 1 + Number(step >= LAST)];
  const vars = { "--col": column, "--progress": progressOf(step) } as CSSProperties;
  return (
    <figure ref={ref} className={st.demo} data-step={step}>
      <figcaption className={st.visuallyHidden}>
        An example run: Maya creates issue ORI-42, the Chief assigns it to the Developer and the Designer, the Developer works on a branch and opens
        pull request 42, the Chief reviews it and Maya merges it, which moves the issue to Done.
      </figcaption>
      <div className={st.chrome}>
        <span className={st.crumb}><span className={st.project} aria-hidden="true" />Website relaunch<span className={st.sep}>/</span>Issues</span>
        {!reduced && (
          <button type="button" className={st.pause} onClick={() => setPaused(!paused)} aria-label={paused ? "Play the example" : "Pause the example"}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
          </button>
        )}
      </div>
      <div className={st.body} aria-hidden="true">
        <div className={st.board} style={vars}>
          {COLUMNS.map((name, index) => (
            <div key={name} className={st.column} style={{ gridColumn: index + 1 }} />
          ))}
          {COLUMNS.map((name, index) => (
            <p key={name} className={st.columnHead} style={{ gridColumn: index + 1 }}>{name}<span>{counts[index]}</span></p>
          ))}
          <div ref={card} className={st.card}>
            <div className={st.cardTop}><span className={st.key}>ORI-42</span><Badge step={step} /></div>
            <p className={st.title}>Pricing page</p>
            <div className={st.cardBottom}>
              <span className={st.assignees}>
                <AgentAvatar id="developer" size={18} />
                <AgentAvatar id="designer" size={18} />
              </span>
              <span className={st.progress}><i /></span>
            </div>
          </div>
          <div className={clsx(st.card, st.still)} style={{ gridColumn: 1, gridRow: 3 }}>
            <div className={st.cardTop}><span className={st.key}>ORI-39</span></div>
            <p className={st.title}>Welcome email</p>
          </div>
          <div className={clsx(st.card, st.still)} style={{ gridColumn: 3, gridRow: 3 }}>
            <div className={st.cardTop}><span className={st.key}>ORI-37</span><span className={clsx(st.badge, st.merged)}><GitMerge size={11} /></span></div>
            <p className={st.title}>Footer links</p>
          </div>
        </div>
        <ol className={st.feed}>
          {EVENTS.map((event, index) => (
            <li key={index} data-shown={step > index ? "" : undefined} data-current={step === index + 1 ? "" : undefined}>
              {event.actor === "you" ? <span className={st.person}>M</span> : <AgentAvatar id={event.actor} size={22} />}
              <p><b>{event.name}</b> {event.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </figure>
  );
}
