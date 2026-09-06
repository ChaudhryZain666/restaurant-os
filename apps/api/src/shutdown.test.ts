import { describe, expect, it, jest } from "@jest/globals";
import { createShutdownHandler, type ShutdownDeps } from "./shutdown.js";

function makeDeps(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = [];
  const deps: ShutdownDeps = {
    closeServer: jest.fn(async () => {
      calls.push("closeServer");
    }),
    closeWorker: jest.fn(async () => {
      calls.push("closeWorker");
    }),
    closeRedis: jest.fn(async () => {
      calls.push("closeRedis");
    }),
    closeQueueConnection: jest.fn(async () => {
      calls.push("closeQueueConnection");
    }),
    logger: { info: jest.fn(), error: jest.fn() },
    exit: jest.fn(),
    ...overrides,
  };
  return { deps, calls };
}

describe("createShutdownHandler (Phase 48)", () => {
  it("closes dependencies in order — server, then worker, then redis, then queue connection — and exits 0", async () => {
    const { deps, calls } = makeDeps();
    const shutdown = createShutdownHandler(deps);

    await shutdown("SIGTERM");

    expect(calls).toEqual(["closeServer", "closeWorker", "closeRedis", "closeQueueConnection"]);
    expect(deps.exit).toHaveBeenCalledWith(0);
    expect(deps.logger.info).toHaveBeenCalledWith("shutting down", { signal: "SIGTERM" });
  });

  it("is re-entrant-safe — a second call while/after shutdown is already handled is a no-op", async () => {
    const { deps } = makeDeps();
    const shutdown = createShutdownHandler(deps);

    await shutdown("SIGTERM");
    await shutdown("SIGINT");

    expect(deps.closeServer).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it("force-exits with code 1 if a dependency throws", async () => {
    const { deps } = makeDeps({
      closeWorker: jest.fn(async () => {
        throw new Error("worker close failed");
      }),
    });
    const shutdown = createShutdownHandler(deps);

    await shutdown("SIGTERM");

    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.logger.error).toHaveBeenCalledWith(
      "[shutdown] error during shutdown, forcing exit",
      expect.objectContaining({ error: "worker close failed" })
    );
    // Never reached the steps after the one that threw.
    expect(deps.closeRedis).not.toHaveBeenCalled();
    expect(deps.closeQueueConnection).not.toHaveBeenCalled();
  });

  it("force-exits with code 1 if shutdown does not complete within the configured timeout", async () => {
    jest.useFakeTimers();
    try {
      const { deps } = makeDeps({
        // Never resolves — simulates a hung in-flight job.
        closeWorker: jest.fn(() => new Promise<void>(() => {})),
      });
      const shutdown = createShutdownHandler({ ...deps, timeoutMs: 10_000 });

      const shutdownPromise = shutdown("SIGTERM");
      await jest.advanceTimersByTimeAsync(10_000);
      await Promise.race([shutdownPromise, Promise.resolve()]);

      expect(deps.exit).toHaveBeenCalledWith(1);
      expect(deps.logger.error).toHaveBeenCalledWith(expect.stringContaining("did not complete within"));
    } finally {
      jest.useRealTimers();
    }
  });
});
