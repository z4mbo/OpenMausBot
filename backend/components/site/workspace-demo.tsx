"use client";

import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import clsx from "clsx";
import {
  Archive, ArrowRight, BookOpen, CalendarDays, ChevronDown, Circle, CircleCheck, Columns3, Diamond, Eraser, FileImage, FileText, Flag, GitBranch, GitCommitHorizontal,
  GripVertical, Hand, Hash, Image as ImageIcon, Inbox, Lock, LockKeyhole, Menu, MessageCircle, MessageSquareText, Mic, MicOff, Minus, MonitorUp, MoreHorizontal,
  MousePointer2, Paperclip, Pencil, PenTool, PhoneOff, Pin, Plus, Redo2, RotateCcw, Search, Send, Settings2, Square, Type, Undo2, Users, Video, VideoOff,
} from "lucide-react";
import { Count, roughArrow, roughRect, usePrefersReducedMotion } from "./primitives";
import s from "./demo.module.css";

/* ------------------------------------------------------------------ data */

type PersonId = "alex" | "sam" | "rin";
type Tone = "lime" | "cyan" | "violet";
const people: Record<PersonId, { name: string; initial: string; tone: Tone; role: string }> = {
  alex: { name: "Alex", initial: "A", tone: "lime", role: "Admin" },
  sam: { name: "Sam", initial: "S", tone: "cyan", role: "Member" },
  rin: { name: "Rin", initial: "R", tone: "violet", role: "Member" },
};

type Priority = "high" | "medium" | "low";
type ColumnId = "idea" | "todo" | "progress";
type Card = { id: string; title: string; priority: Priority; assignee?: PersonId; due?: string; dueTone?: "soon" | "overdue"; github?: number; done?: boolean; leaving?: boolean; lifted?: boolean; placedAt?: number };
type Finished = Card & { from: ColumnId };
type ProjectState = { board: Record<ColumnId, Card[]>; completed: Finished[] };
type ProjectId = "website" | "mobile" | "design";

const columns: { id: ColumnId; title: string; tone: "idea" | "todo" | "custom" }[] = [
  { id: "idea", title: "Idea", tone: "idea" },
  { id: "todo", title: "Todo", tone: "todo" },
  { id: "progress", title: "In progress", tone: "custom" },
];
const columnTitle = (id: ColumnId) => columns.find(column => column.id === id)!.title;

const projects: { id: ProjectId; name: string; description: string; commits: number; members: number; glyph: string }[] = [
  { id: "website", name: "Website", description: "Design and build our new website.", commits: 12, members: 3, glyph: "◐" },
  { id: "mobile", name: "Mobile app", description: "Origin, in your pocket.", commits: 4, members: 2, glyph: "▢" },
  { id: "design", name: "Design system", description: "Tokens, type, and the components we share.", commits: 0, members: 2, glyph: "◇" },
];

function initialProjects(): Record<ProjectId, ProjectState> {
  return {
    website: {
      board: {
        idea: [{ id: "ORI-HCA8", title: "Explore homepage directions", priority: "medium", assignee: "alex", due: "Oct 2" }],
        todo: [
          { id: "ORI-HE31", title: "Ship responsive navigation", priority: "high", assignee: "sam", github: 128, due: "Tomorrow", dueTone: "soon" },
          { id: "ORI-HNQ0", title: "Design responsive type scale", priority: "low", assignee: "alex", due: "Sep 29" },
        ],
        progress: [{ id: "ORI-G4KR", title: "Review the onboarding flow", priority: "high", assignee: "rin", due: "Today", dueTone: "soon" }],
      },
      completed: [{ id: "ORI-G1ZB", title: "Set up the project workspace", priority: "medium", assignee: "alex", from: "todo" }],
    },
    mobile: {
      board: {
        idea: [{ id: "ORI-M7TD", title: "Offline drafts for chat", priority: "low" }],
        todo: [{ id: "ORI-M2QX", title: "Notification settings screen", priority: "medium", assignee: "rin" }],
        progress: [],
      },
      completed: [
        { id: "ORI-M0AA", title: "Mobile sidebar", priority: "medium", assignee: "sam", from: "progress" },
        { id: "ORI-M0AB", title: "Swipe between columns", priority: "low", assignee: "rin", from: "progress" },
      ],
    },
    design: { board: { idea: [], todo: [], progress: [] }, completed: [] },
  };
}

type Reference = { kind: "project"; label: string } | { kind: "issue"; id: string; title: string; column: string };
type Message = { id: string; author: PersonId; time: string; text: string; ref?: Reference; reaction?: string; day?: string };
const initialMessages: Message[] = [
  { id: "m1", author: "sam", time: "11:58 AM", text: "I'll take the mobile navigation. Want to jump into Draw together?" },
  { id: "m2", author: "alex", time: "11:59 AM", text: "On my way. Added the next steps to the board.", ref: { kind: "project", label: "Website" } },
  { id: "m3", author: "rin", time: "12:04 PM", text: "I sketched two directions for the onboarding flow. The simpler one feels right.", day: "Today" },
  { id: "m4", author: "alex", time: "12:06 PM", text: "Agreed. Let's keep the first step focused on creating a workspace." },
];

type View = "inbox" | "chat" | "call" | "draw" | "project";
type Tab = "issues" | "repo" | "assets" | "vault" | "team" | "settings";
type Point = { x: number; y: number };
type Box = Point & { w: number; h: number };
type CursorState = Point & { on: boolean; press: boolean; duration: number };
type Ghost = { card: Card; x: number; y: number; w: number; dx: number; dy: number; duration: number };
type Mode = "boot" | "tour" | "paused";

const LAUNCH_NOTES = "Write the launch notes";

/* ----------------------------------------------------------- component */

export function WorkspaceDemo() {
  const reduced = usePrefersReducedMotion();
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("boot");
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState<View>("project");
  const [tab, setTab] = useState<Tab>("issues");
  const [projectId, setProjectId] = useState<ProjectId>("website");
  const [data, setData] = useState(initialProjects);
  const [drafts, setDrafts] = useState<Partial<Record<ColumnId, string>>>({});
  const [tourComposer, setTourComposer] = useState<ColumnId | null>(null);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [cursors, setCursors] = useState<Record<"sam" | "rin", CursorState>>({
    sam: { x: 980, y: 560, on: false, press: false, duration: 0 },
    rin: { x: 420, y: 640, on: false, press: false, duration: 0 },
  });
  const [messages, setMessages] = useState(initialMessages);
  const [typing, setTyping] = useState<PersonId | null>(null);
  const [sketchRun, setSketchRun] = useState(0);
  const [rinStroke, setRinStroke] = useState<"idle" | "drawing" | "done">("done");

  const inTour = mode === "tour";

  /* Assembly: the first time the replica is on screen, every component drops into place. The tour starts once it lands. */
  const assembled = useRef(false);
  const tourTimer = useRef<number | undefined>(undefined);
  const [waiting, setWaiting] = useState(true);
  const [inFrame, setInFrame] = useState(false);
  useEffect(() => () => window.clearTimeout(tourTimer.current), []);
  useEffect(() => { if (reduced) setWaiting(false); }, [reduced]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { setInFrame(true); observer.disconnect(); } }, { threshold: 0.45 });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const frame = frameRef.current;
    if (!inFrame || assembled.current || !frame || reduced) return;
    assembled.current = true;
    const base = frame.getBoundingClientRect().top;
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
    const drop = (element: HTMLElement, delay: number, extra: number, spin: number, duration: number) => {
      const rect = element.getBoundingClientRect();
      const start = -(rect.top - base + rect.height + 24 + extra);
      element.animate([
        { transform: `translateY(${start}px) rotate(${spin}deg)`, opacity: 0, easing: "cubic-bezier(.5,0,.85,.4)" },
        { opacity: 1, offset: 0.25 },
        { transform: `translateY(8px) rotate(${-spin * 0.25}deg)`, offset: 0.66, easing: "cubic-bezier(.2,.7,.3,1)" },
        { transform: `translateY(-3px) rotate(${spin * 0.08}deg)`, offset: 0.84, easing: "ease-in-out" },
        { transform: "none", opacity: 1 },
      ], { duration, delay, fill: "backwards" });
    };
    const visibleIn = (selector: string) => [...frame.querySelectorAll<HTMLElement>(selector)].filter(element => element.getBoundingClientRect().width > 0);
    let at = Math.max(250, 1150 - performance.now());
    frame.querySelector<HTMLElement>(`.${s.chrome}`)?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 500, delay: at - 200, fill: "backwards" });
    const groups: [string, number][] = [
      [`.${s.sideTop}, .${s.switcher}`, 70],
      [`.${s.navItem}`, 55],
      [`.${s.sectionHead}`, 0],
      [`.${s.project}`, 60],
      [`.${s.sideFoot}`, 0],
      [`.${s.mobileNav} > button`, 45],
      [`.${s.identity}, .${s.tabs} > button`, 50],
      [`.${s.boardBar} > *`, 55],
      [`.${s.column}`, 110],
    ];
    for (const [selector, gap] of groups) {
      const items = visibleIn(selector);
      items.forEach((element, index) => drop(element, at + index * gap, random() * 50, (random() - 0.5) * 4, 850));
      at += items.length ? Math.max(120, items.length * gap * 0.75) : 0;
    }
    at += 320;
    const lanes = visibleIn(`.${s.column}`).map(column => [...column.querySelectorAll<HTMLElement>(`[data-card], .${s.composer}`)]);
    const depth = Math.max(0, ...lanes.map(lane => lane.length));
    for (let row = 0; row < depth; row += 1) lanes.forEach((lane, laneIndex) => { if (lane[row]) drop(lane[row], at + row * 140 + laneIndex * 55, 90 + random() * 90, (random() - 0.5) * 9, 950); });
    setWaiting(false);
    tourTimer.current = window.setTimeout(() => setMode(current => current === "boot" ? "tour" : current), at + depth * 140 + 1300);
  }, [inFrame, reduced]);
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(frame);
    return () => observer.disconnect();
  }, []);

  /* --------------------------------------------------- board mutations */

  const updateProject = (id: ProjectId, change: (project: ProjectState) => ProjectState) => setData(current => ({ ...current, [id]: change(current[id]) }));

  const moveCard = (pid: ProjectId, cardId: string, to: ColumnId, index?: number) => updateProject(pid, project => {
    let moving: Card | undefined;
    const board = { ...project.board };
    for (const column of columns) {
      const found = board[column.id].find(card => card.id === cardId);
      if (found) { moving = found; board[column.id] = board[column.id].filter(card => card.id !== cardId); }
    }
    if (!moving) return project;
    const list = [...board[to]];
    list.splice(index ?? list.length, 0, { ...moving, lifted: false, placedAt: Date.now() });
    board[to] = list;
    return { ...project, board };
  });

  const patchCard = (pid: ProjectId, cardId: string, patch: Partial<Card>) => updateProject(pid, project => {
    const board = { ...project.board };
    for (const column of columns) board[column.id] = board[column.id].map(card => card.id === cardId ? { ...card, ...patch } : card);
    return { ...project, board };
  });

  /** Remove a finished card from the board and file it under Completed. Safe to call twice. */
  const fileCompleted = (pid: ProjectId, cardId: string) => updateProject(pid, project => {
    for (const column of columns) {
      const found = project.board[column.id].find(card => card.id === cardId);
      if (found) {
        return {
          board: { ...project.board, [column.id]: project.board[column.id].filter(card => card.id !== cardId) },
          completed: [{ ...found, done: true, leaving: false, from: column.id }, ...project.completed],
        };
      }
    }
    return project;
  });

  const completeCard = (pid: ProjectId, cardId: string) => {
    patchCard(pid, cardId, { done: true });
    window.setTimeout(() => patchCard(pid, cardId, { leaving: true }), 620);
    window.setTimeout(() => fileCompleted(pid, cardId), 1040);
  };

  const restoreCard = (pid: ProjectId, cardId: string) => updateProject(pid, project => {
    const found = project.completed.find(card => card.id === cardId);
    if (!found) return project;
    const { from, ...card } = found;
    return { completed: project.completed.filter(item => item.id !== cardId), board: { ...project.board, [from]: [...project.board[from], { ...card, done: false }] } };
  });

  const addCard = (pid: ProjectId, column: ColumnId, title: string, id?: string) => updateProject(pid, project => ({
    ...project,
    board: { ...project.board, [column]: [...project.board[column], { id: id ?? `ORI-${Math.random().toString(36).slice(2, 6).toUpperCase()}`, title, priority: "medium" as Priority, assignee: "alex" as PersonId }] },
  }));

  /** Finish anything the tour left mid-flight. */
  const settle = () => {
    setGhost(null);
    setTyping(null);
    setTourComposer(null);
    setDrafts({});
    setCursors(current => ({ sam: { ...current.sam, on: false, press: false }, rin: { ...current.rin, on: false, press: false } }));
    setData(current => {
      const next = { ...current };
      for (const pid of Object.keys(next) as ProjectId[]) {
        let project = next[pid];
        for (const column of columns) {
          for (const card of project.board[column.id]) {
            if (card.leaving || card.done) {
              project = { board: { ...project.board, [column.id]: project.board[column.id].filter(item => item.id !== card.id) }, completed: [{ ...card, done: true, leaving: false, from: column.id }, ...project.completed] };
            } else if (card.lifted) {
              project = { ...project, board: { ...project.board, [column.id]: project.board[column.id].map(item => item.id === card.id ? { ...item, lifted: false } : item) } };
            }
          }
        }
        next[pid] = project;
      }
      return next;
    });
  };

  /* -------------------------------------------------------------- tour */

  useEffect(() => {
    if (mode !== "tour" || !visible) return;
    const controller = new AbortController();
    const { signal } = controller;
    const wait = (ms: number) => new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new DOMException("Tour stopped", "AbortError"));
      const timer = window.setTimeout(resolve, ms);
      signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Tour stopped", "AbortError")); }, { once: true });
    });
    const frame = () => frameRef.current;
    const wide = () => (frame()?.offsetWidth ?? 0) >= 900;
    const boxOf = (selector: string): Box | null => {
      const root = frame();
      const element = root?.querySelector(selector);
      if (!root || !element) return null;
      const rect = element.getBoundingClientRect();
      const base = root.getBoundingClientRect();
      if (!rect.width) return null;
      return { x: rect.left - base.left, y: rect.top - base.top, w: rect.width, h: rect.height };
    };
    const center = (box: Box, ax = 0.5, ay = 0.5): Point => ({ x: box.x + box.w * ax, y: box.y + box.h * ay });
    const moveCursor = (who: "sam" | "rin", point: Point, duration: number) => {
      setCursors(current => ({ ...current, [who]: { ...current[who], ...point, on: true, duration } }));
      return wait(duration);
    };
    const press = (who: "sam" | "rin", value: boolean) => setCursors(current => ({ ...current, [who]: { ...current[who], press: value } }));
    const click = async (who: "sam" | "rin") => { press(who, true); await wait(150); press(who, false); };
    const hideCursors = () => setCursors(current => ({ sam: { ...current.sam, on: false }, rin: { ...current.rin, on: false } }));

    const boardScene = async () => {
      setProjectId("website"); setTab("issues"); setView("project");
      await wait(1400);
      const useCursors = wide();

      // Sam drags navigation into In progress.
      const from = boxOf('[data-card="ORI-HE31"]');
      if (useCursors && from) {
        const grip = center(from, 0.58, 0.46);
        await moveCursor("sam", grip, 1100);
        press("sam", true);
        const card = initialProjects().website.board.todo[0];
        patchCard("website", "ORI-HE31", { lifted: true });
        setGhost({ card, x: from.x, y: from.y, w: from.w, dx: 0, dy: 0, duration: 0 });
        await wait(240);
        const list = boxOf('[data-list="progress"]');
        const last = boxOf('[data-list="progress"] > [data-card]:last-of-type');
        if (list) {
          const target = { x: list.x, y: last ? last.y + last.h + 10 : list.y };
          const dx = target.x - from.x;
          const dy = target.y - from.y;
          setGhost(current => current && { ...current, dx, dy, duration: 1050 });
          await moveCursor("sam", { x: grip.x + dx, y: grip.y + dy }, 1050);
        }
        press("sam", false);
      }
      moveCard("website", "ORI-HE31", "progress");
      setGhost(null);
      await wait(900);

      // Rin checks off the onboarding review.
      const check = boxOf('[data-card="ORI-G4KR"] [data-check]');
      if (useCursors && check) {
        await moveCursor("rin", center(check, 0.4, 0.5), 1150);
        await click("rin");
      }
      patchCard("website", "ORI-G4KR", { done: true });
      await wait(650);
      patchCard("website", "ORI-G4KR", { leaving: true });
      await wait(420);
      fileCompleted("website", "ORI-G4KR");
      await wait(500);

      // You (Alex) add a new issue.
      if (useCursors) {
        const header = boxOf("[data-progress]");
        if (header) void moveCursor("sam", center(header, 0.2, 1.6), 1300);
        const inProgress = boxOf('[data-list="progress"]');
        if (inProgress) void moveCursor("rin", center(inProgress, 0.7, 0.9), 1400);
      }
      setTourComposer("idea");
      await wait(500);
      for (let index = 1; index <= LAUNCH_NOTES.length; index += 1) {
        setDrafts({ idea: LAUNCH_NOTES.slice(0, index) });
        await wait(34 + (index % 4) * 14);
      }
      await wait(420);
      addCard("website", "idea", LAUNCH_NOTES, "ORI-K2P7");
      setDrafts({});
      setTourComposer(null);
      await wait(2000);
    };

    const chatScene = async () => {
      hideCursors();
      setView("chat");
      await wait(1000);
      setTyping("sam");
      await wait(1500);
      setTyping(null);
      setMessages(current => [...current, { id: "t1", author: "sam", time: "12:31 PM", text: "Navigation is in progress. Anyone free to review it after lunch?", ref: { kind: "issue", id: "ORI-HE31", title: "Ship responsive navigation", column: "In progress" } }]);
      await wait(1400);
      setTyping("rin");
      await wait(1200);
      setTyping(null);
      setMessages(current => [...current, { id: "t2", author: "rin", time: "12:32 PM", text: "I'll review it. Meet you in Draw first." }]);
      await wait(700);
      setMessages(current => current.map(message => message.id === "t1" ? { ...message, reaction: "2" } : message));
      await wait(1700);
    };

    const drawScene = async () => {
      setRinStroke("idle");
      setSketchRun(run => run + 1);
      setView("draw");
      await wait(2500);
      const start = boxOf('[data-anchor="arrow-start"]');
      const end = boxOf('[data-anchor="arrow-end"]');
      if (wide() && start && end) {
        await moveCursor("rin", center(start), 900);
        setRinStroke("drawing");
        await moveCursor("rin", center(end), 820);
      }
      setRinStroke("done");
      await wait(900);
      if (wide()) {
        const note = boxOf('[data-anchor="note"]');
        if (note) void moveCursor("rin", center(note, 0.9, 0.2), 1200);
      }
      await wait(1800);
    };

    const callScene = async () => {
      hideCursors();
      setView("call");
      await wait(5200);
    };

    const reset = () => {
      setData(initialProjects());
      setMessages(initialMessages);
      setDrafts({});
    };

    (async () => {
      reset();
      setView("project");
      await wait(600);
      while (!signal.aborted) {
        await boardScene();
        await chatScene();
        await drawScene();
        await callScene();
        reset();
      }
    })().catch(() => undefined);

    return () => { controller.abort(); settle(); };
    // The tour owns its own timeline; restarting it on every render would reset the demo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, visible]);

  const focusComposer = () => window.setTimeout(() => frameRef.current?.querySelector<HTMLInputElement>('[data-composer="idea"]')?.focus(), 80);

  const project = projects.find(item => item.id === projectId)!;
  const state = data[projectId];
  const open = columns.reduce((total, column) => total + state.board[column.id].filter(card => !card.done).length, 0);
  const openCount = (pid: ProjectId) => columns.reduce((total, column) => total + data[pid].board[column.id].filter(card => !card.done).length, 0);
  const progress = open + state.completed.length ? Math.round(state.completed.length / (open + state.completed.length) * 100) : 0;

  const go = (next: View, pid?: ProjectId) => {
    setView(next);
    if (pid) { setProjectId(pid); setTab("issues"); }
  };

  return (
    <div className={s.demo} role="img" aria-label="Animated preview of the Origin workspace. Teammates move and complete issues, then the tour moves through chat, drawing, and a call.">
      <div ref={frameRef} className={s.frame} data-waiting={waiting ? "" : undefined} aria-hidden="true" inert>
        <div className={s.chrome} aria-hidden="true">
          <span className={s.lights}><i /><i /><i /></span>
          <span className={s.url}><Lock size={11} />origin.local<b>/studio</b></span>
          <span className={s.presence}>{(["rin", "sam", "alex"] as PersonId[]).map(id => <Avatar key={id} id={id} />)}</span>
        </div>
        <div className={s.app}>
          <aside className={s.sidebar} aria-label="Workspace navigation">
            <div className={s.sideTop}>
              <span className={s.profile}><Avatar id="alex" />alex</span>
              <span className={s.iconBtn} aria-hidden="true"><Menu size={15} /></span>
              <button type="button" className={clsx(s.iconBtn, s.newIssue)} aria-label="Create issue" onClick={() => { go("project", "website"); focusComposer(); }}><Plus size={15} /></button>
              <span className={s.iconBtn} aria-hidden="true"><Search size={15} /></span>
            </div>
            <div className={s.switcher}>Studio<ChevronDown size={12} /></div>
            <nav className={s.nav}>
              <NavItem icon={<Inbox size={16} />} label="Inbox" count={3} active={view === "inbox"} onClick={() => go("inbox")} dot />
              <NavItem icon={<MessageCircle size={16} />} label="Chat" active={view === "chat"} onClick={() => go("chat")} />
              <NavItem icon={<Video size={16} />} label="Call" count={2} active={view === "call"} onClick={() => go("call")} />
              <NavItem icon={<PenTool size={16} />} label="Draw" active={view === "draw"} onClick={() => go("draw")} />
            </nav>
            <div className={s.sectionHead}><ChevronDown size={14} /><span>Projects</span><Plus size={14} /></div>
            <div className={s.projects}>
              {projects.map(item => (
                <button key={item.id} type="button" className={clsx(s.project, view === "project" && projectId === item.id && s.active)} onClick={() => go("project", item.id)} aria-current={view === "project" && projectId === item.id ? "page" : undefined}>
                  <span className={s.glyph} aria-hidden="true">{item.glyph}</span>
                  <span className={s.projectName}>{item.name}</span>
                  {item.id === "website" && <span className={s.viewers} aria-label="Sam and Rin are viewing"><Avatar id="sam" /><Avatar id="rin" /></span>}
                  <small>{openCount(item.id)}</small>
                </button>
              ))}
            </div>
            <div className={s.sideFoot}><span className={s.wsInitial}>S</span>Studio<span>Owner</span></div>
          </aside>

          <nav className={s.mobileNav} aria-label="Workspace navigation">
            {([["inbox", Inbox, "Inbox"], ["chat", MessageCircle, "Chat"], ["call", Video, "Call"], ["draw", PenTool, "Draw"], ["project", Columns3, "Website"]] as const).map(([id, Icon, label]) => (
              <button key={id} type="button" className={clsx(view === id && s.active)} onClick={() => go(id, id === "project" ? "website" : undefined)} aria-pressed={view === id}><Icon size={16} /><span>{label}</span></button>
            ))}
          </nav>

          <main className={s.workspace}>
            <div className={s.view} key={view === "project" ? `project-${projectId}` : view}>
              {view === "project" && (
                <ProjectView
                  project={project}
                  state={state}
                  progress={progress}
                  tab={tab}
                  onTab={setTab}
                  drafts={drafts}
                  onDraft={(column, value) => setDrafts(current => ({ ...current, [column]: value }))}
                  tourComposer={tourComposer}
                  onCreateIssue={focusComposer}
                  onAdd={(column, title) => { addCard(projectId, column, title); setDrafts(current => ({ ...current, [column]: "" })); }}
                  onToggle={card => card.done ? patchCard(projectId, card.id, { done: false }) : completeCard(projectId, card.id)}
                  onMove={(cardId, column, index) => moveCard(projectId, cardId, column, index)}
                  onRestore={cardId => restoreCard(projectId, cardId)}
                />
              )}
              {view === "chat" && <ChatView messages={messages} typing={typing} onSend={text => setMessages(current => [...current, { id: `u${current.length}`, author: "alex", time: "Now", text }])} onOpenIssue={() => go("project", "website")} />}
              {view === "draw" && <DrawView run={sketchRun} rinStroke={rinStroke} reduced={reduced} />}
              {view === "call" && <CallView reduced={reduced} />}
              {view === "inbox" && <InboxView onOpen={() => go("project", "website")} />}
            </div>
          </main>
        </div>

        {ghost && (
          <div className={s.ghost} data-priority={ghost.card.priority} style={{ left: ghost.x, top: ghost.y, width: ghost.w, transform: `translate3d(${ghost.dx}px, ${ghost.dy}px, 0) rotate(2.2deg)`, transitionDuration: `${ghost.duration}ms` }} aria-hidden="true">
            <CardBody card={ghost.card} />
          </div>
        )}
        <Cursor who="sam" state={cursors.sam} />
        <Cursor who="rin" state={cursors.rin} />
      </div>

      <p className={s.caption}><span className={clsx(s.liveDot, inTour && s.liveOn)} aria-hidden="true" />Live preview<em>Synthetic demo data</em></p>
    </div>
  );
}

/* ------------------------------------------------------------- pieces */

function Avatar({ id, size }: { id: PersonId; size?: "lg" | "xl" }) {
  const person = people[id];
  return <span className={clsx(s.avatar, s[person.tone], size && s[size])} aria-hidden="true">{person.initial}</span>;
}

function NavItem({ icon, label, count, active, onClick, dot }: { icon: ReactNode; label: string; count?: number; active: boolean; onClick: () => void; dot?: boolean }) {
  return (
    <button type="button" className={clsx(s.navItem, active && s.active)} onClick={onClick} aria-current={active ? "page" : undefined}>
      {icon}<span>{label}</span>{dot && <i className={s.unread} />}{count !== undefined && <small>{count}</small>}
    </button>
  );
}

function Cursor({ who, state }: { who: "sam" | "rin"; state: CursorState }) {
  const person = people[who];
  return (
    <div className={clsx(s.cursor, s[person.tone], state.on && s.cursorOn, state.press && s.cursorPress)} style={{ transform: `translate3d(${state.x}px, ${state.y}px, 0)`, transitionDuration: `${state.duration}ms, 280ms` }} aria-hidden="true">
      <svg width="18" height="20" viewBox="0 0 18 20"><path d="M2 1.8 16 9.4 9.6 11.1 6.6 17.8Z" fill="currentColor" stroke="#08090a" strokeWidth="1.3" strokeLinejoin="round" /></svg>
      <span>{person.name}</span>
    </div>
  );
}

function CardBody({ card, onToggle }: { card: Card; onToggle?: () => void }) {
  const icon = card.done ? <CircleCheck size={17} /> : <Circle size={17} />;
  return (
    <>
      <div className={s.cardHead}>
        <span className={s.code}>{card.id}{card.github && <GitBranch size={11} aria-label={`Linked to GitHub issue #${card.github}`} />}</span>
        <GripVertical size={14} className={s.grip} aria-hidden="true" />
      </div>
      <div className={s.cardTop}>
        {onToggle
          ? <button type="button" data-check className={s.check} aria-label={`${card.done ? "Reopen" : "Complete"} ${card.title}`} onClick={onToggle}>{icon}</button>
          : <span className={s.check} aria-hidden="true">{icon}</span>}
        <strong>{card.title}</strong>
      </div>
      <div className={s.meta}>
        <span className={clsx(s.priority, s[card.priority])}><Flag size={11} />{card.priority}</span>
        {card.due && <span className={clsx(s.due, card.dueTone && s[card.dueTone])}><CalendarDays size={11} />{card.due}</span>}
        {card.assignee && <span className={s.assignee}><Avatar id={card.assignee} /></span>}
      </div>
    </>
  );
}

/** Animate cards to their new positions after any board change (FLIP). */
function useCardFlip(scroller: RefObject<HTMLDivElement | null>) {
  const rects = useRef(new Map<string, Point>());
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const base = root.getBoundingClientRect();
    const next = new Map<string, Point>();
    const hadCards = rects.current.size > 0;
    root.querySelectorAll<HTMLElement>("[data-card]").forEach(element => {
      const id = element.dataset.card!;
      const rect = element.getBoundingClientRect();
      const position = { x: rect.left - base.left + root.scrollLeft, y: rect.top - base.top + root.scrollTop };
      next.set(id, position);
      const previous = rects.current.get(id);
      if (element.dataset.placed !== undefined) {
        // Already dropped where it belongs (by a drag or the tour's ghost); don't fly it again.
      } else if (previous) {
        const dx = previous.x - position.x;
        const dy = previous.y - position.y;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) element.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" });
      } else if (hadCards) {
        element.animate([{ opacity: 0, transform: "translateY(-8px) scale(.97)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: "cubic-bezier(.2,.8,.2,1)" });
      }
    });
    rects.current = next;
  });
}

type ProjectViewProps = {
  project: (typeof projects)[number];
  state: ProjectState;
  progress: number;
  tab: Tab;
  onTab: (tab: Tab) => void;
  drafts: Partial<Record<ColumnId, string>>;
  onDraft: (column: ColumnId, value: string) => void;
  tourComposer: ColumnId | null;
  onCreateIssue: () => void;
  onAdd: (column: ColumnId, title: string) => void;
  onToggle: (card: Card) => void;
  onMove: (cardId: string, column: ColumnId, index?: number) => void;
  onRestore: (cardId: string) => void;
};

const tabs: { id: Tab; label: string; icon: typeof Columns3 }[] = [
  { id: "issues", label: "Issues", icon: Columns3 },
  { id: "repo", label: "Repo", icon: GitBranch },
  { id: "assets", label: "Assets", icon: Paperclip },
  { id: "vault", label: "Vault", icon: LockKeyhole },
  { id: "team", label: "Team", icon: Users },
  { id: "settings", label: "Settings", icon: Settings2 },
];

function ProjectView(props: ProjectViewProps) {
  const { project, progress, tab, onTab } = props;
  return (
    <div className={s.projectShell}>
      <div className={s.tabsRow}>
        <div className={s.identity}><span className={s.glyph} aria-hidden="true">{project.glyph}</span><h3>{project.name}</h3></div>
        <div className={s.tabs} role="tablist" aria-label={`${project.name} sections`}>
          {tabs.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={clsx(tab === id && s.active)} onClick={() => onTab(id)}><Icon size={15} />{label}</button>
          ))}
        </div>
      </div>
      {tab === "issues" && <BoardView {...props} progress={progress} />}
      {tab === "repo" && <RepoPanel />}
      {tab === "assets" && <AssetsPanel />}
      {tab === "vault" && <VaultPanel />}
      {tab === "team" && <TeamPanel />}
      {tab === "settings" && <SettingsPanel name={project.name} description={project.description} />}
    </div>
  );
}

function BoardView({ state, progress, drafts, onDraft, tourComposer, onAdd, onToggle, onMove, onRestore, onTab, onCreateIssue }: ProjectViewProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scope, setScope] = useState<"active" | "completed">("active");
  const [filter, setFilter] = useState("");
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ColumnId | null>(null);
  useCardFlip(scroller);
  const matches = (card: Card) => card.title.toLowerCase().includes(filter.trim().toLowerCase());
  const activeCount = columns.reduce((total, column) => total + state.board[column.id].length, 0);

  const drop = (event: DragEvent, column: ColumnId) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || dragging;
    if (id) onMove(id, column);
    setDragging(null); setOver(null);
  };

  return (
    <>
      <div className={s.boardBar}>
        <div className={s.segment}>
          <button type="button" className={clsx(scope === "active" && s.active)} onClick={() => setScope("active")}><Columns3 size={14} />Active<small>{activeCount}</small></button>
          <button type="button" className={clsx(scope === "completed" && s.active)} onClick={() => setScope("completed")}><CircleCheck size={14} />Completed<small>{state.completed.length}</small></button>
        </div>
        <span className={s.ring} data-progress title={`${progress}% of issues completed`}>
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" /><circle cx="18" cy="18" r="15" pathLength={100} style={{ strokeDasharray: `${progress} 100` }} /></svg>
          <strong><Count value={progress} suffix="%" /></strong>
        </span>
        <label className={s.filter}><Search size={14} /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filter issues" aria-label="Filter issues" /></label>
        <span className={s.columnBtn} aria-hidden="true"><Columns3 size={14} />Column</span>
        <button type="button" className={s.createIssue} onClick={() => { onTab("issues"); onCreateIssue(); }}><Plus size={14} />Create issue</button>
      </div>
      {scope === "completed" ? (
        <div className={s.completedList}>
          {state.completed.length === 0 && <p className={s.emptyNote}><CircleCheck size={16} />Completed work will appear here.</p>}
          {state.completed.filter(matches).map(card => (
            <div key={card.id} className={s.completedRow}>
              <CircleCheck size={16} />
              <span className={s.code}>{card.id}</span>
              <strong>{card.title}</strong>
              <small>{columnTitle(card.from)}</small>
              <button type="button" onClick={() => onRestore(card.id)}><RotateCcw size={12} />Restore</button>
            </div>
          ))}
        </div>
      ) : (
        <div className={s.kanban} ref={scroller}>
          {columns.map(column => {
            const cards = state.board[column.id].filter(matches);
            const draft = drafts[column.id] ?? "";
            return (
              <section
                key={column.id}
                className={clsx(s.column, s[column.tone], over === column.id && s.dropTarget)}
                aria-label={`${column.title} column`}
                onDragOver={event => { event.preventDefault(); setOver(column.id); }}
                onDragLeave={() => setOver(current => current === column.id ? null : current)}
                onDrop={event => drop(event, column.id)}
              >
                <div className={s.columnHead}>
                  <span><i className={s.columnDot} />{column.title}</span>
                  <span className={s.columnTools}><small>{state.board[column.id].length}</small><MoreHorizontal size={15} aria-hidden="true" /></span>
                </div>
                <div className={s.list} data-list={column.id}>
                  {cards.length === 0 && <div className={s.emptyLane}>{filter ? "No matching issues" : column.id === "progress" && state.completed.length ? <><Archive size={14} />{state.completed.length} completed</> : "No issues"}</div>}
                  {cards.map(card => (
                    <article
                      key={card.id}
                      data-card={card.id}
                      data-priority={card.priority}
                      data-placed={card.placedAt && Date.now() - card.placedAt < 400 ? "" : undefined}
                      className={clsx(s.card, card.done && s.cardDone, card.leaving && s.cardLeaving, (card.lifted || dragging === card.id) && s.cardLifted)}
                      draggable
                      onDragStart={event => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; setDragging(card.id); }}
                      onDragEnd={() => { setDragging(null); setOver(null); }}
                    >
                      <CardBody card={card} onToggle={() => onToggle(card)} />
                    </article>
                  ))}
                </div>
                <form className={clsx(s.composer, tourComposer === column.id && s.composerTour)} onSubmit={(event: FormEvent) => { event.preventDefault(); if (draft.trim()) onAdd(column.id, draft.trim()); }}>
                  <input
                    value={draft}
                    onChange={event => onDraft(column.id, event.target.value)}
                    placeholder="Add issue"
                    aria-label={`Add issue to ${column.title}`}
                    data-composer={column.id}
                    maxLength={60}
                  />
                  {tourComposer === column.id && <span className={s.tourText} aria-hidden="true">{draft}<i className={s.caret} /></span>}
                  <button type="submit" aria-label={`Add issue to ${column.title}`}><Plus size={15} /></button>
                </form>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function RepoPanel() {
  const commits = [
    ["a41c9e2", "feat: responsive navigation drawer", "Sam", "12m"],
    ["7d02b18", "fix: focus ring on column menu", "Rin", "1h"],
    ["19fe6c3", "chore: tighten type scale tokens", "Alex", "3h"],
    ["c80a5d1", "feat: public feedback form", "Sam", "Yesterday"],
  ];
  return (
    <div className={s.panel}>
      <div className={s.repoHead}><GitBranch size={15} /><strong>z4mbo/origin-workspace</strong><span className={s.badge}>Private</span><span className={s.muted}>main</span></div>
      <ul className={s.commitList}>
        {commits.map(([sha, message, author, when]) => <li key={sha}><GitCommitHorizontal size={14} /><code>{sha}</code><span>{message}</span><small>{author} · {when}</small></li>)}
      </ul>
    </div>
  );
}

function AssetsPanel() {
  const assets = [["hero-sketch.png", FileImage, "1.2 MB"], ["type-scale.pdf", FileText, "320 KB"], ["logo-mark.svg", FileImage, "4 KB"], ["onboarding-copy.md", FileText, "6 KB"]] as const;
  return <div className={clsx(s.panel, s.assetGrid)}>{assets.map(([name, Icon, size]) => <div key={name} className={s.asset}><Icon size={22} /><strong>{name}</strong><small>{size}</small></div>)}</div>;
}

function VaultPanel() {
  return (
    <div className={clsx(s.panel, s.vault)}>
      <LockKeyhole size={22} />
      <strong>Vault is locked</strong>
      <p>Secrets are encrypted in your browser with the vault passphrase before they are saved.</p>
      <ul>{["STAGING_DATABASE_URL", "ANALYTICS_WRITE_KEY", "SMTP_PASSWORD"].map(name => <li key={name}><code>{name}</code><span>••••••••••••</span></li>)}</ul>
    </div>
  );
}

function TeamPanel() {
  return (
    <div className={s.panel}>
      <ul className={s.teamList}>
        {(Object.keys(people) as PersonId[]).map(id => <li key={id}><Avatar id={id} size="lg" /><strong>{people[id].name}</strong><span>{people[id].name.toLowerCase()}@studio.test</span><em>{people[id].role}</em></li>)}
      </ul>
    </div>
  );
}

function SettingsPanel({ name, description }: { name: string; description: string }) {
  return (
    <div className={clsx(s.panel, s.settings)}>
      <div><span>Project name</span><p>{name}</p></div>
      <div><span>Description</span><p>{description}</p></div>
      <div><span>Public feedback form</span><p>Off. Turn it on to collect ideas from people outside the workspace.</p></div>
    </div>
  );
}

/* ----------------------------------------------------------------- chat */

function ChatView({ messages, typing, onSend, onOpenIssue }: { messages: Message[]; typing: PersonId | null; onSend: (text: string) => void; onOpenIssue: () => void }) {
  const [draft, setDraft] = useState("");
  const list = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = list.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
  }, [messages.length, typing]);
  return (
    <div className={s.chat}>
      <header className={s.viewHead}>
        <h3><MessageCircle size={20} />Team chat</h3>
        <span className={s.headTools}><span className={s.searchFake}><Search size={14} />Search messages</span><Pin size={15} /><span>3 members</span></span>
      </header>
      <div className={s.messages} ref={list}>
        {messages.map(message => (
          <div key={message.id}>
            {message.day && <div className={s.day}><span>{message.day}</span></div>}
            <div className={clsx(s.message, message.id.startsWith("t") || message.id.startsWith("u") ? s.fresh : undefined)}>
              <span className={s.chatAvatar} aria-hidden="true">{people[message.author].name.slice(0, 2).toUpperCase()}</span>
              <div>
                <p className={s.byline}><strong>{people[message.author].name}</strong><time>{message.time}</time></p>
                <p>{message.text}</p>
                {message.ref?.kind === "project" && <span className={s.refChip}><Hash size={12} />{message.ref.label}</span>}
                {message.ref?.kind === "issue" && (
                  <button type="button" className={s.issueRef} onClick={onOpenIssue}>
                    <Circle size={14} /><code>{message.ref.id}</code><strong>{message.ref.title}</strong><small><i />{message.ref.column}</small>
                  </button>
                )}
                {message.reaction && <span className={s.reaction}>🙌 {message.reaction}</span>}
              </div>
            </div>
          </div>
        ))}
        <div className={clsx(s.typing, typing && s.typingOn)} aria-live="polite">{typing && <><span className={s.dots}><i /><i /><i /></span>{people[typing].name} is typing</>}</div>
      </div>
      <form className={s.chatComposer} onSubmit={event => { event.preventDefault(); if (draft.trim()) { onSend(draft.trim()); setDraft(""); } }}>
        <input value={draft} onChange={event => setDraft(event.target.value)} placeholder="Message Studio…" aria-label="Message Studio" maxLength={200} />
        <div><span aria-hidden="true"><Paperclip size={16} /><Hash size={16} /></span><button type="submit" aria-label="Send message" disabled={!draft.trim()}><Send size={15} /></button></div>
      </form>
    </div>
  );
}

/* ----------------------------------------------------------------- draw */

const sketch = {
  boxes: [
    { d: roughRect(170, 150, 170, 84, 3), d2: roughRect(171, 151, 169, 83, 9), color: "#b99cff", label: "Create a space", x: 255 },
    { d: roughRect(410, 150, 170, 84, 5), d2: roughRect(411, 149, 170, 85, 13), color: "#58c7d9", label: "Invite your team", x: 495 },
    { d: roughRect(650, 150, 170, 84, 7), d2: roughRect(649, 151, 171, 84, 17), color: "#3ddc97", label: "Make a start", x: 735 },
  ],
  arrows: [roughArrow(344, 193, 404, 193, 4, 4), roughArrow(584, 193, 644, 193, 6, 4)],
  phone: roughRect(420, 290, 150, 206, 21, 18),
  input: roughRect(440, 352, 110, 30, 23, 6),
  button: roughRect(440, 398, 110, 30, 29, 6),
  rin: roughArrow(700, 408, 588, 452, 31, -14),
};

type Tool = "lock" | "hand" | "select" | "rect" | "diamond" | "circle" | "arrow" | "line" | "pencil" | "text" | "image" | "eraser";
const tools: { id: Tool; icon: typeof Square; label: string }[] = [
  { id: "hand", icon: Hand, label: "Hand" }, { id: "select", icon: MousePointer2, label: "Selection" }, { id: "rect", icon: Square, label: "Rectangle" },
  { id: "diamond", icon: Diamond, label: "Diamond" }, { id: "circle", icon: Circle, label: "Ellipse" }, { id: "arrow", icon: ArrowRight, label: "Arrow" },
  { id: "line", icon: Minus, label: "Line" }, { id: "pencil", icon: Pencil, label: "Draw" }, { id: "text", icon: Type, label: "Text" },
  { id: "image", icon: ImageIcon, label: "Image" }, { id: "eraser", icon: Eraser, label: "Eraser" },
];

function DrawView({ run, rinStroke, reduced }: { run: number; rinStroke: "idle" | "drawing" | "done"; reduced: boolean }) {
  const svg = useRef<SVGSVGElement | null>(null);
  const [tool, setTool] = useState<Tool>("pencil");
  const [chosen, setChosen] = useState(false);
  const [strokes, setStrokes] = useState<string[]>([]);
  const [live, setLive] = useState("");
  const drawing = useRef<string | null>(null);

  const toCanvas = (event: ReactPointerEvent) => {
    const element = svg.current!;
    const point = element.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const matrix = element.getScreenCTM();
    const result = matrix ? point.matrixTransform(matrix.inverse()) : point;
    return `${result.x.toFixed(1)} ${result.y.toFixed(1)}`;
  };
  const canDraw = (event: ReactPointerEvent) => tool === "pencil" && (event.pointerType !== "touch" || chosen);

  return (
    <div className={s.draw}>
      <header className={s.viewHead}><h3><PenTool size={20} />Draw</h3><span className={s.headTools}>Shared canvas</span></header>
      <div className={s.drawStatus}><span>All changes saved</span><span><i className={s.onlineDot} />3 online</span></div>
      <div className={clsx(s.canvasWrap, chosen && s.touchDraw)}>
        <div className={s.toolbar} role="toolbar" aria-label="Drawing tools">
          <span className={s.toolLock} aria-hidden="true"><Lock size={14} /></span>
          {tools.map(({ id, icon: Icon, label }) => (
            <button key={id} type="button" aria-label={label} aria-pressed={tool === id} className={clsx(tool === id && s.active)} onClick={() => { setTool(id); setChosen(true); }}><Icon size={15} /></button>
          ))}
        </div>
        <span className={s.library} aria-hidden="true"><BookOpen size={14} />Library</span>
        <svg
          ref={svg}
          key={run}
          className={clsx(s.canvas, !reduced && s.sketching)}
          viewBox="0 0 990 540"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="Shared sketch of a three-step onboarding flow"
          onPointerDown={event => { if (!canDraw(event)) return; event.currentTarget.setPointerCapture(event.pointerId); drawing.current = `M${toCanvas(event)}`; setLive(drawing.current); }}
          onPointerMove={event => { if (!drawing.current) return; drawing.current += ` L${toCanvas(event)}`; setLive(drawing.current); }}
          onPointerUp={() => { if (drawing.current) setStrokes(current => [...current.slice(-24), drawing.current!]); drawing.current = null; setLive(""); }}
          onPointerCancel={() => { drawing.current = null; setLive(""); }}
        >
          <g className={s.handText}>
            <text x="170" y="92" fill="#b99cff" fontSize="36" style={{ animationDelay: "0.05s" }}>A better first hello</text>
            <text x="172" y="128" fill="#e6e7ea" fontSize="18" style={{ animationDelay: "0.35s" }}>Keep the first step simple.</text>
          </g>
          {sketch.boxes.map((box, index) => (
            <g key={box.label}>
              <path d={box.d} stroke={box.color} pathLength={1} className={s.stroke} style={{ animationDelay: `${0.4 + index * 0.35}s` }} />
              <path d={box.d2} stroke={box.color} pathLength={1} className={clsx(s.stroke, s.second)} style={{ animationDelay: `${0.55 + index * 0.35}s` }} />
              <text x={box.x} y="199" textAnchor="middle" fill={box.color} fontSize="19" className={s.handLabel} style={{ animationDelay: `${0.8 + index * 0.35}s` }}>{box.label}</text>
            </g>
          ))}
          {sketch.arrows.map((d, index) => <path key={d} d={d} stroke="#4dabf7" pathLength={1} className={s.stroke} style={{ animationDelay: `${1 + index * 0.35}s` }} />)}
          <path d={sketch.phone} stroke="#58c7d9" pathLength={1} className={s.stroke} style={{ animationDelay: "1.5s" }} />
          <text x="495" y="330" textAnchor="middle" fill="#58c7d9" fontSize="16" className={s.handLabel} style={{ animationDelay: "1.8s" }}>Your workspace</text>
          <path d={sketch.input} stroke="#d8d9dd" pathLength={1} className={s.stroke} style={{ animationDelay: "1.85s" }} />
          <text x="452" y="372" fill="#d8d9dd" fontSize="13" className={s.handLabel} style={{ animationDelay: "2s" }}>Studio</text>
          <path d={sketch.button} stroke="#b99cff" pathLength={1} className={s.stroke} style={{ animationDelay: "2s" }} />
          <text x="495" y="418" textAnchor="middle" fill="#b99cff" fontSize="13" className={s.handLabel} style={{ animationDelay: "2.15s" }}>Continue</text>
          <path d={sketch.rin} stroke="#ff8a3d" pathLength={1} className={clsx(s.ink, s.rinStroke, rinStroke === "drawing" && s.rinDrawing, rinStroke === "done" && s.rinDone)} />
          <g className={clsx(s.note, rinStroke === "done" && s.noteOn)} data-anchor="note">
            <text x="690" y="372" fill="#ff8a3d" fontSize="22">Less setup.</text>
            <text x="690" y="402" fill="#ff8a3d" fontSize="22">More making.</text>
          </g>
          <circle data-anchor="arrow-start" cx="700" cy="408" r="1" fill="none" />
          <circle data-anchor="arrow-end" cx="588" cy="452" r="1" fill="none" />
          {strokes.map((d, index) => <path key={index} d={d} className={s.userStroke} />)}
          {live && <path d={live} className={s.userStroke} />}
        </svg>
        <div className={s.zoom} aria-hidden="true"><Minus size={13} /><span>100%</span><Plus size={13} /></div>
        <div className={s.history}>
          <button type="button" aria-label="Undo" disabled={!strokes.length} onClick={() => setStrokes(current => current.slice(0, -1))}><Undo2 size={14} /></button>
          <span aria-hidden="true"><Redo2 size={14} /></span>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- call */

function CallView({ reduced }: { reduced: boolean }) {
  const [seconds, setSeconds] = useState(724);
  const [speaker, setSpeaker] = useState(0);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(false);
  const [joined, setJoined] = useState(true);
  useEffect(() => {
    const clock = window.setInterval(() => setSeconds(value => value + 1), 1000);
    const talk = reduced ? 0 : window.setInterval(() => setSpeaker(value => (value + 1) % 3), 1700);
    return () => { window.clearInterval(clock); if (talk) window.clearInterval(talk); };
  }, [reduced]);
  const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const order: PersonId[] = ["sam", "rin", "alex"];
  const speaking = joined ? order[speaker] : null;
  if (!joined) {
    return (
      <div className={s.call}>
        <header className={s.viewHead}><h3><Video size={20} />Call</h3></header>
        <div className={s.leftCall}><PhoneOff size={22} /><strong>You left the call</strong><p>Sam and Rin are still in Website sync.</p><button type="button" className={s.rejoin} onClick={() => setJoined(true)}>Rejoin</button></div>
      </div>
    );
  }
  return (
    <div className={s.call}>
      <header className={s.viewHead}><h3><Video size={20} />Call</h3><span className={s.headTools}><span className={s.recDot} />Website sync · {time}</span></header>
      <div className={s.callGrid}>
        <div className={clsx(s.tile, s.share, speaking === "sam" && s.speaking)}>
          <div className={s.sharedScreen} aria-hidden="true">
            <div className={s.miniSide}><i /><i /><i /><i /></div>
            <div className={s.miniBoard}>{[3, 1, 2].map((count, index) => <div key={index}>{Array.from({ length: count }, (_, item) => <i key={item} />)}</div>)}</div>
          </div>
          <span className={s.tileName}><MonitorUp size={12} />Sam is sharing</span>
        </div>
        {(["rin", "alex"] as PersonId[]).map(id => (
          <div key={id} className={clsx(s.tile, speaking === id && s.speaking)}>
            <span className={s.tileAvatar}><Avatar id={id} size="xl" /></span>
            {speaking === id && <span className={s.bars} aria-hidden="true"><i /><i /><i /><i /></span>}
            <span className={s.tileName}>{id === "alex" ? "You" : people[id].name}{id === "alex" && !mic && <MicOff size={12} />}</span>
          </div>
        ))}
      </div>
      <div className={s.controls}>
        <button type="button" aria-pressed={!mic} aria-label={mic ? "Mute microphone" : "Unmute microphone"} className={clsx(!mic && s.off)} onClick={() => setMic(!mic)}>{mic ? <Mic size={16} /> : <MicOff size={16} />}</button>
        <button type="button" aria-pressed={camera} aria-label={camera ? "Turn camera off" : "Turn camera on"} className={clsx(camera && s.on)} onClick={() => setCamera(!camera)}>{camera ? <Video size={16} /> : <VideoOff size={16} />}</button>
        <span aria-hidden="true"><MonitorUp size={16} /></span>
        <button type="button" aria-label="Leave call" className={s.leave} onClick={() => setJoined(false)}><PhoneOff size={16} /></button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- inbox */

function InboxView({ onOpen }: { onOpen: () => void }) {
  const days = [["Mon", 28], ["Tue", 29], ["Wed", 30], ["Thu", 1], ["Fri", 2], ["Sat", 3], ["Sun", 4]] as const;
  const due: Record<number, Priority> = { 1: "low", 2: "medium", 30: "high" };
  const rows = [
    { icon: <Circle size={15} />, code: "ORI-HE31", title: "Ship responsive navigation", meta: "In progress · due Wed", unread: true, priority: "high" as Priority },
    { icon: <Circle size={15} />, code: "ORI-HNQ0", title: "Design responsive type scale", meta: "Todo · due Thu", unread: true, priority: "low" as Priority },
    { icon: <MessageSquareText size={15} />, code: "ORI-G4KR", title: "Rin commented: “Two steps is plenty.”", meta: "Review the onboarding flow", unread: true },
    { icon: <Circle size={15} />, code: "ORI-HCA8", title: "Explore homepage directions", meta: "Idea · due Fri", priority: "medium" as Priority },
  ];
  return (
    <div className={s.inbox}>
      <header className={s.viewHead}><h3><Inbox size={20} />Inbox</h3><span className={s.headTools}><span className={s.pill}>Assigned to me</span><CalendarDays size={15} /></span></header>
      <div className={s.week}>
        {days.map(([name, date]) => (
          <div key={date} className={clsx(date === 30 && s.today)}>
            <span>{name}</span><strong>{date}</strong>{due[date] && <i className={s[due[date]]} />}
          </div>
        ))}
      </div>
      <ul className={s.inboxList}>
        {rows.map(row => (
          <li key={row.title}>
            <button type="button" onClick={onOpen}>
              <i className={clsx(s.unread, !row.unread && s.read)} aria-label={row.unread ? "Unread" : undefined} />
              {row.icon}
              <code>{row.code}</code>
              <span><strong>{row.title}</strong><small>{row.meta}</small></span>
              {row.priority && <span className={clsx(s.priority, s[row.priority])}><Flag size={11} />{row.priority}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
