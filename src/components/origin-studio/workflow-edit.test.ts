import { describe, expect, it } from "vitest";
import { copyNodes, emptyHistory, pasteNodes, recordEdit, redoEdit, searchPalette, undoEdit } from "./workflow-edit";
import { studioWorkflowTemplate, validateWorkflow, type StudioWorkflowGraph } from "../../../shared/studio-workflow";

const podcast = studioWorkflowTemplate("template:podcast-kit")!.graph;

describe("copy and paste", () => {
  it("copies the chosen nodes with the links between them and pastes them under new ids", () => {
    const clip = copyNodes(podcast, new Set(["p1", "m1", "p2"]))!;
    expect(clip.nodes.map((node) => node.id)).toEqual(["p1", "m1", "p2"]);
    expect(clip.edges.map((edge) => `${edge.from}>${edge.to}`)).toEqual(["p1>m1"]);
    const pasted = pasteNodes(podcast, clip, { x: 32, y: 32 })!;
    expect(pasted.ids).toHaveLength(3);
    expect(pasted.graph.nodes).toHaveLength(podcast.nodes.length + 3);
    const [prompt, model] = pasted.ids.map((id) => pasted.graph.nodes.find((node) => node.id === id)!);
    expect(prompt).toMatchObject({ type: "prompt", x: 72, y: 72 });
    expect(pasted.graph.edges.at(-1)).toMatchObject({ from: prompt!.id, to: model!.id, toPort: "prompt" });
    expect(validateWorkflow(pasted.graph).filter((problem) => problem.message.includes("share an id"))).toEqual([]);
  });

  it("copies nothing from an empty selection and refuses to pass the node limit", () => {
    expect(copyNodes(podcast, new Set())).toBeNull();
    const many: StudioWorkflowGraph = { nodes: Array.from({ length: 39 }, (_, index) => ({ id: `n${index}`, type: "prompt", x: 0, y: 0, params: {} })), edges: [] };
    expect(pasteNodes(many, copyNodes(podcast, new Set(["p1", "m1"]))!, { x: 0, y: 0 })).toBeNull();
  });
});

describe("undo and redo", () => {
  const a: StudioWorkflowGraph = { nodes: [], edges: [] };
  const b: StudioWorkflowGraph = { nodes: [{ id: "x", type: "prompt", x: 0, y: 0, params: {} }], edges: [] };
  const c: StudioWorkflowGraph = { nodes: [{ id: "x", type: "prompt", x: 10, y: 0, params: {} }], edges: [] };

  it("walks back and forward, and a new edit clears what was undone", () => {
    let history = recordEdit(emptyHistory(), a, undefined, 0);
    history = recordEdit(history, b, undefined, 10);
    const back = undoEdit(history, c)!;
    expect(back.graph).toBe(b);
    const forward = redoEdit(back.history, back.graph)!;
    expect(forward.graph).toBe(c);
    expect(recordEdit(back.history, b, undefined, 20).future).toEqual([]);
    expect(undoEdit(emptyHistory(), a)).toBeNull();
    expect(redoEdit(emptyHistory(), a)).toBeNull();
  });

  it("merges one drag or one burst of typing into a single step", () => {
    let history = recordEdit(emptyHistory(), a, "move:x", 0);
    history = recordEdit(history, b, "move:x", 300);
    history = recordEdit(history, c, "move:x", 600);
    expect(history.past).toEqual([a]);
    history = recordEdit(history, c, "move:x", 2_000);
    expect(history.past).toEqual([a, c]);
  });
});

describe("node palette search", () => {
  it("finds models and presets by any word, best label matches first", () => {
    expect(searchPalette("kling")[0]!.label).toBe("Kling 3 Pro");
    expect(searchPalette("upscale video").map((entry) => entry.label)).toContain("Topaz video upscale");
    expect(searchPalette("broadcast")[0]!.id).toBe("output-broadcast");
    expect(searchPalette("zzz")).toEqual([]);
    expect(searchPalette("").length).toBeGreaterThan(20);
  });
});
