"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Bell, CalendarDays, Check, Circle, CircleCheck, CircleDot, Flag, GitBranch, GitMerge, GitPullRequest, Paperclip } from "lucide-react";
import { GitHubMark, roughArrow, roughRect } from "./primitives";
import j from "./journey.module.css";

const stages = [
  {
    lane: "Idea",
    tone: "idea",
    title: "Start with a rough sketch.",
    body: "Talk it through on a call and sketch it on the shared canvas. When it's worth doing, create an issue and attach the drawing. A chat message can become an issue the same way.",
  },
  {
    lane: "Todo",
    tone: "todo",
    title: "Give it an owner and a date.",
    body: "Set the priority, assignee, and due date. The issue lands in their Inbox and on the calendar, with comments and mentions in one thread.",
  },
  {
    lane: "In progress",
    tone: "progress",
    title: "Build it in GitHub.",
    body: "Create the linked GitHub issue from Origin, then work in the repository with your own tools. A branch icon marks the link on the card.",
  },
  {
    lane: "Completed",
    tone: "done",
    title: "Close it once.",
    body: "Close the GitHub issue and Origin completes its counterpart. Finished work leaves the board but stays one click away, grouped by the column it finished in.",
  },
] as const;

export function Journey() {
  const [active, setActive] = useState(0);
  const [seen, setSeen] = useState<number[]>([]);
  const steps = useRef<(HTMLElement | null)[]>([]);

  useEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = Number((entry.target as HTMLElement).dataset.index);
        setActive(index);
        setSeen(current => current.includes(index) ? current : [...current, index]);
      }
    }, { rootMargin: "-48% 0px -48% 0px" });
    steps.current.forEach(step => step && observer.observe(step));
    return () => observer.disconnect();
  }, []);

  return (
    <section id="workflow" className={j.section} aria-labelledby="workflow-title">
      <div className={j.intro} data-reveal>
        <p className={j.eyebrow}>How work moves</p>
        <h2 id="workflow-title">One issue, from sketch to shipped.</h2>
        <p className={j.lede}>Idea, Todo, and In progress are the columns every new project starts with. Rename them or add your own. Here&apos;s what happens to an issue on its way through.</p>
      </div>
      <div className={j.layout}>
        <ol className={j.steps}>
          {stages.map((stage, index) => (
            <li key={stage.lane} ref={element => { steps.current[index] = element; }} data-index={index} className={clsx(j.step, active === index && j.current)}>
              <span className={clsx(j.lane, j[stage.tone])}>{stage.tone === "done" ? <CircleCheck size={13} /> : <i />}{stage.lane}</span>
              <h3>{stage.title}</h3>
              <p>{stage.body}</p>
              <div className={j.inline}><Stage stage={seen.includes(index) ? index : Math.max(0, index - 1)} replay={seen.includes(index) ? 1 : 0} /></div>
            </li>
          ))}
        </ol>
        <div className={j.sticky} aria-hidden="true">
          <Stage stage={active} />
        </div>
      </div>
    </section>
  );
}

const BASE_W = 440;
const BASE_H = 520;

const sketch = {
  a: roughRect(14, 34, 104, 58, 41, 10),
  b: roughRect(146, 34, 104, 58, 43, 10),
  c: roughRect(278, 34, 104, 58, 47, 10),
  ab: roughArrow(120, 63, 142, 63, 3, 2),
  bc: roughArrow(252, 63, 274, 63, 5, 2),
  strike: "M150 40 L246 88 M246 42 L152 86",
  loop: roughArrow(66, 100, 326, 100, 9, -34),
};

function Stage({ stage, replay = 0 }: { stage: number; replay?: number }) {
  const box = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const update = () => setScale(element.clientWidth / BASE_W);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={box} className={j.stageBox} style={{ height: BASE_H * scale }} aria-hidden="true">
      <div className={j.stage} data-stage={stage} style={{ transform: `scale(${scale})` }}>
        <div className={j.track}>
          <span className={j.trackLine}><i style={{ width: `${(stage / 3) * 100}%` }} /></span>
          {stages.map((item, index) => (
            <span key={item.lane} className={clsx(j.node, j[item.tone], index <= stage && j.reached, index === stage && j.here)}>
              <b>{item.tone === "done" && index <= stage ? <Check size={9} strokeWidth={3.5} /> : null}</b>
              <em>{item.lane}</em>
            </span>
          ))}
        </div>

        <svg className={j.sketch} viewBox="0 0 400 150" key={`sketch-${stage === 0}-${replay}`}>
          <path d={sketch.a} pathLength={1} style={{ animationDelay: "0.1s" }} />
          <path d={sketch.b} pathLength={1} style={{ animationDelay: "0.3s" }} />
          <path d={sketch.c} pathLength={1} style={{ animationDelay: "0.5s" }} />
          <path d={sketch.ab} pathLength={1} style={{ animationDelay: "0.65s" }} />
          <path d={sketch.bc} pathLength={1} style={{ animationDelay: "0.75s" }} />
          <text x="66" y="68" textAnchor="middle">Sign up</text>
          <text x="198" y="68" textAnchor="middle">Name it</text>
          <text x="330" y="68" textAnchor="middle">Invite</text>
          <path className={j.strike} d={sketch.strike} pathLength={1} style={{ animationDelay: "1.1s" }} />
          <path className={j.loop} d={sketch.loop} pathLength={1} style={{ animationDelay: "1.35s" }} />
          <text className={j.noteText} x="200" y="140" textAnchor="middle">two steps is plenty?</text>
        </svg>

        <article className={j.card}>
          <div className={j.cardHead}>
            <code>ORI-7F2A</code>
            <span className={j.linked}><GitBranch size={11} />#128</span>
          </div>
          <div className={j.cardTitle}>
            <span className={j.check}>{stage === 3 ? <CircleCheck size={18} /> : <Circle size={18} />}</span>
            <strong>Shorten onboarding to two steps</strong>
          </div>
          <div className={j.attachment}><Paperclip size={12} />onboarding-sketch.png</div>
          <div className={j.metaWrap}>
            <div className={j.meta}>
              <span className={clsx(j.chip, j.high)}><Flag size={11} />high</span>
              <span className={clsx(j.chip, j.person)}><i>S</i>Sam</span>
              <span className={clsx(j.chip, j.due)}><CalendarDays size={11} />Fri, Oct 2</span>
              <span className={clsx(j.chip, j.doneChip)}><CircleCheck size={12} />Completed</span>
            </div>
          </div>
        </article>

        <div className={j.toast}>
          <span className={j.toastLabel}>Sam&apos;s inbox</span>
          <div className={j.toastRow}>
            <span className={j.bell}><Bell size={14} /></span>
            <p><strong>Alex assigned you ORI-7F2A</strong><small>Shorten onboarding to two steps · due Fri</small></p>
          </div>
          <div className={j.week}>
            {["M", "T", "W", "T", "F"].map((day, index) => <span key={index} className={clsx(index === 4 && j.dueDay)}>{day}<i /></span>)}
          </div>
        </div>

        <div className={j.github}>
          <div className={j.ghHead}><GitHubMark size={14} /><span>z4mbo/origin-workspace</span></div>
          <div className={j.ghRow}>
            <span className={j.ghIcon}>{stage === 3 ? <CircleCheck size={15} /> : <CircleDot size={15} />}</span>
            <span><b>#128</b> Shorten onboarding to two steps</span>
            <em className={clsx(j.state, stage === 3 ? j.closed : j.open)}>{stage === 3 ? "Closed" : "Open"}</em>
          </div>
          <div className={j.ghRow}>
            <span className={j.ghIcon}>{stage === 3 ? <GitMerge size={15} /> : <GitPullRequest size={15} />}</span>
            <span><b>#131</b> Merge naming into sign-up</span>
            <em className={clsx(j.state, stage === 3 ? j.merged : j.open)}>{stage === 3 ? "Merged" : "Open"}</em>
          </div>
          <code className={j.closes}>Closes #128</code>
        </div>

        <div className={j.sync}><i /><span>Synced to Origin</span></div>

        <div className={j.meter}>
          <span>Website progress</span>
          <div className={j.bar}><i /></div>
          <strong>{stage === 3 ? "40%" : "20%"}</strong>
        </div>
      </div>
    </div>
  );
}
