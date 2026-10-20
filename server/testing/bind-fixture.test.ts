import { expect, it, vi } from "vitest";
import { retryFixtureBind } from "./bind-fixture.ts";

it("waits for a collided child's close before launching a fresh binding", async () => {
  const order: string[] = [];
  const launch = vi.fn(async () => {
    const index = launch.mock.calls.length;
    order.push(`launch-${index}`);
    return {
      ready: async () => {
        order.push(`ready-${index}`);
        if (index === 1) throw new Error("child exited during listen");
        return "owned fixture";
      },
      output: () => index === 1 ? "Error: listen EADDRINUSE: address already in use 127.0.0.1:21001" : "listening",
      close: async () => {
        await new Promise(resolve => setImmediate(resolve));
        order.push(`closed-${index}`);
      },
    };
  });
  expect(await retryFixtureBind(launch)).toBe("owned fixture");
  expect(order).toEqual(["launch-1", "ready-1", "closed-1", "launch-2", "ready-2"]);
});

it("does not hide a non-binding child failure", async () => {
  const error = new Error("invalid fixture configuration");
  const close = vi.fn(async () => {});
  const launch = vi.fn(async () => ({ ready: async () => { throw error; }, output: () => "Error: invalid configuration", close }));
  await expect(retryFixtureBind(launch)).rejects.toBe(error);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
});

it("bounds collisions to three children and closes the final child", async () => {
  const error = new Error("fixture never bound");
  const close = vi.fn(async () => {});
  const launch = vi.fn(async () => ({ ready: async () => { throw error; }, output: () => "listen EADDRINUSE", close }));
  await expect(retryFixtureBind(launch)).rejects.toBe(error);
  expect(launch).toHaveBeenCalledTimes(3);
  expect(close).toHaveBeenCalledTimes(3);
});
