import { expect, it, vi } from "vitest";
import { Lane } from "./engine.ts";
import { DataFailure } from "./types.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

it.each(["signal", "lane"] as const)("keeps %s cancellation owned through delayed dispatch and leaves its successor alone", async (source) => {
  vi.useFakeTimers();
  const entered = deferred(), dispatch = deferred();
  let rejectRunning: ((error: Error) => void) | undefined;
  const interrupt = vi.fn(() => rejectRunning?.(new Error("Interrupted!")));
  const lane = new Lane({ interrupt } as never);
  const abort = new AbortController();
  const work = lane.run("SELECT delayed", { signal: abort.signal }, async () => {
    entered.resolve();
    await dispatch.promise;
    return new Promise<never>((_resolve, reject) => { rejectRunning = reject; });
  });
  const failed = work.catch((error: unknown) => error);
  try {
    await entered.promise;
    if (source === "signal") abort.abort();
    else lane.interrupt();
    expect(interrupt).toHaveBeenCalledTimes(1);
    dispatch.resolve();
    await vi.advanceTimersByTimeAsync(100);
    const calls = interrupt.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    const error = await failed;
    expect(error).toBeInstanceOf(DataFailure);
    expect((error as DataFailure).error.code).toBe("cancelled");
    expect(await lane.run("SELECT successor", {}, async () => {
      await vi.advanceTimersByTimeAsync(100);
      return "successor";
    })).toBe("successor");
    expect(interrupt).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    dispatch.resolve();
    rejectRunning?.(new Error("test cleanup"));
    await failed;
    vi.useRealTimers();
  }
});

it("rejects cancelled work that finishes before another interrupt is needed", async () => {
  const entered = deferred(), finish = deferred();
  const lane = new Lane({ interrupt() {} } as never);
  const abort = new AbortController();
  const work = lane.run("SELECT fast", { signal: abort.signal }, async () => {
    entered.resolve();
    await finish.promise;
    return "stale success";
  });
  const failed = work.catch((error: unknown) => error);
  await entered.promise;
  abort.abort();
  finish.resolve();
  const error = await failed;
  expect(error).toBeInstanceOf(DataFailure);
  expect((error as DataFailure).error.code).toBe("cancelled");
});
