import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DrawingCanvas } from "../../src/components/origin-pages/DrawingCanvas";
import { ProjectDrawPage } from "../../src/components/OriginDraw";
import { DesignPage } from "../../src/components/origin-design/DesignPage";
import { applyCanvasOps } from "../../shared/canvas-ops";
import { connectorSpec, stickySpec, strokeSpec } from "../../shared/canvas-board";
import { slideSpec } from "../../shared/canvas-deck";
import { encodeNode } from "../../shared/canvas-scene";
import { initialState, StoreContext, type Bot } from "../../src/state/store";
import { applySkin } from "../../src/lib/skins";
import "../../src/styles.css";
const params = new URLSearchParams(location.search);
applySkin(params.get("theme") === "light" ? "daylight" : "midnight");
const chief = { id: "fixture-chief", name: "Atlas", title: "Chief", chiefOfStaff: true, color: "green", section: "Fixture project", messages: [], modelSelection: { instanceId: "fixture", model: "fixture" }, threadId: "fixture-thread", description: "", notifications: false, unread: false } as Bot;
const designer = { ...chief, id: "fixture-designer", name: "Dana", title: "Designer", chiefOfStaff: false, color: "purple", threadId: "fixture-designer-thread" } as Bot;
const sent: unknown[] = [];
const seeded = (ops: unknown[]) => applyCanvasOps(new Map(), ops).changed.map(encodeNode);
const fixture = (window as unknown as { originDrawFixture: { addCanvas(id: string, name: string, kind: string, rows: string[]): void } }).originDrawFixture;
if (params.has("design")) {
  const notes = [["Ship Design as its own page", "green", 0, 0], ["Boards for brainstorms", "yellow", 280, 0], ["Pitch decks agents can draft", "blue", 560, 0], ["Flaky CI on Windows", "pink", 0, 300]] as const;
  const box = (x: number, y: number) => ({ x, y, width: 240, height: 240 });
  fixture.addCanvas("fixture-board", "Launch retro", "board", seeded([
    ...notes.map(([text, color, x, y]) => ({ op: "create", node: stickySpec({ text, color, x, y }) })),
    { op: "create", node: connectorSpec(box(0, 0), box(280, 0)) },
    { op: "create", node: connectorSpec(box(280, 0), box(560, 0)) },
    { op: "create", node: strokeSpec(Array.from({ length: 40 }, (_, at): [number, number] => [300 + at * 12, 380 + Math.sin(at / 3) * 30]), { color: "#E03131", width: 4 }) },
    { op: "create", node: { type: "text", text: "What went well → what to fix", x: 0, y: -90, fontSize: 36, fontWeight: 700, fill: "#1E1E1E" } },
  ]));
  fixture.addCanvas("fixture-deck", "Seed pitch", "deck", seeded([
    slideSpec({ layout: "title", title: "Origin", subtitle: "Projects, people and AI agents in one workspace" }, 0),
    slideSpec({ title: "The problem", bullets: ["Teams juggle ten tools", "Agents work blind, outside the team's files", "Design, code and launch live apart"], notes: "Open with the launch-week story." }, 1),
    slideSpec({ layout: "stat", stat: "3×", title: "Faster from idea to launch", subtitle: "Measured across our pilot teams" }, 2),
    slideSpec({ layout: "closing", title: "Thank you", subtitle: "origin.imbored.fun" }, 3),
  ].map((node) => ({ op: "create", node }))));
}
Object.assign(window, { originCanvasSent: sent });
function Fixture() {
  const [open, setOpen] = useState(true);
  return <main className="flex h-dvh min-w-0 flex-col bg-app text-ink">
    <div className="flex shrink-0 gap-2 border-b border-hairline px-3 py-2 text-xs">
      <button onClick={() => setOpen(!open)}>{open ? "Leave canvas" : "Return to canvas"}</button>
    </div>
    {open ? params.has("design") ? <DesignPage agent={chief} cloudProjectId="fixture-project" projectName="Fixture project" /> : params.has("project") ? <ProjectDrawPage agent={chief} cloudProjectId="fixture-project" projectName="Fixture project" /> : <DrawingCanvas teamId="fixture-team" canvasId="fixture-canvas" projectId="fixture-project" userId="fixture-user" name="Release planning" agent={chief} readOnly={params.has("viewer")} /> : <p className="p-4 text-sm">Canvas closed</p>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StoreContext.Provider value={{ state: { ...initialState, bots: [chief, designer] }, dispatch: (action: unknown) => { sent.push(action); }, flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} }}><Fixture /></StoreContext.Provider>);
