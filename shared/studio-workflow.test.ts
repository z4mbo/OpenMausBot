import { describe, expect, it } from "vitest";
import { STUDIO_MODELS, studioEta, studioInput, studioModel } from "./studio.ts";
import { STUDIO_WORKFLOW_TEMPLATES, portsConnect, validateWorkflow, withWorkflowInputs, workflowInputs, workflowOrder, workflowPorts, type StudioWorkflowGraph } from "./studio-workflow.ts";

describe("Studio workflows", () => {
  it("ships templates that run once their file inputs are chosen", () => {
    for (const template of STUDIO_WORKFLOW_TEMPLATES) {
      const files = Object.fromEntries(workflowInputs(template.graph).filter((input) => input.kind !== "text").map((input) => [input.nodeId, "asset1"]));
      expect(validateWorkflow(withWorkflowInputs(template.graph, files)), template.id).toEqual([]);
    }
  });

  it("types every port: text feeds prompts, media feeds its own kind, Output takes any media", () => {
    const prompt = workflowPorts({ id: "p", type: "prompt", x: 0, y: 0, params: {} }).outputs[0]!;
    const avatar = workflowPorts({ id: "m", type: "model", x: 0, y: 0, params: { model: "fal-ai/kling-video/ai-avatar/v2/pro" } });
    expect(avatar.inputs.map((port) => [port.id, port.kind])).toEqual([["prompt", "text"], ["in0", "image"], ["in1", "audio"]]);
    expect(portsConnect(prompt, avatar.inputs[0]!)).toBe(true);
    expect(portsConnect(prompt, avatar.inputs[1]!)).toBe(false);
    const output = workflowPorts({ id: "o", type: "output", x: 0, y: 0, params: {} }).inputs[0]!;
    expect(portsConnect(avatar.outputs[0]!, output)).toBe(true);
    expect(portsConnect(prompt, output)).toBe(false);
  });

  it("names loops, wrong links and missing inputs", () => {
    const graph: StudioWorkflowGraph = {
      nodes: [
        { id: "a", type: "model", x: 0, y: 0, params: { model: "fal-ai/nano-banana-pro/edit" } },
        { id: "b", type: "model", x: 0, y: 0, params: { model: "fal-ai/nano-banana-pro/edit", prompt: "x" } },
      ],
      edges: [{ id: "1", from: "a", fromPort: "media", to: "b", toPort: "in0" }, { id: "2", from: "b", fromPort: "media", to: "a", toPort: "in0" }],
    };
    expect(workflowOrder(graph)).toBeNull();
    expect(validateWorkflow(graph).map((problem) => problem.message)).toEqual(expect.arrayContaining(["The links form a loop.", "Nano Banana Pro edit needs a prompt.", "Add an Output node so the result lands in Assets."]));
  });
});

describe("Studio catalogue", () => {
  it("gives every model a description, an ETA and inputs the fal schema names", () => {
    for (const model of STUDIO_MODELS) {
      expect(model.description.length, model.id).toBeGreaterThan(10);
      expect(model.eta, model.id).toBeGreaterThan(0);
      const input = studioInput(model, { prompt: "p" }, { sources: model.needs.map((kind) => `https://fal.media/${kind}`) });
      expect(Object.values(input).filter((value) => value === undefined).length <= 3, model.id).toBe(true);
    }
    expect(studioInput(studioModel("fal-ai/ffmpeg-api/merge-videos")!, { prompt: "" }, { sources: ["https://a", "https://b"] })).toEqual({ video_urls: ["https://a", "https://b"] });
  });

  it("learns a model's ETA from the project's finished runs", () => {
    const run = (seconds: number) => ({ model: "fal-ai/flux/schnell", status: "done" as const, createdAt: 0, startedAt: 1_000, finishedAt: 1_000 + seconds * 1000 });
    expect(studioEta("fal-ai/flux/schnell", [])).toBe(4);
    expect(studioEta("fal-ai/flux/schnell", [run(10), run(2), run(6)])).toBe(6);
  });
});
