/**
 * Phase 48 — the graceful-shutdown sequence extracted out of index.ts's main() as a small, pure,
 * dependency-injected factory. index.ts can't easily be unit tested as a whole (it's a
 * process-entrypoint script that calls httpServer.listen/process.on at module scope), but the
 * shutdown SEQUENCING itself — re-entrancy guard, ordered close calls, bounded timeout, exit codes
 * — is exactly the kind of logic that benefits from a real test with mocked dependencies and fake
 * timers, so it's split out here rather than left untestable inline.
 */
export interface ShutdownDeps {
  closeServer: () => Promise<void>;
  closeWorker: () => Promise<void>;
  closeRedis: () => Promise<void>;
  closeQueueConnection: () => Promise<void>;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
  exit: (code: number) => void;
  timeoutMs?: number;
}

/**
 * Returns a signal handler that: stops accepting new HTTP connections, lets the notification
 * worker's current in-flight job finish, then closes Redis and the BullMQ connection, then exits —
 * bounded by a hard deadline (default 10s) so a hung step force-exits instead of leaving the
 * process running forever. Re-entrant-safe: a second call (a double SIGTERM/SIGINT) is a no-op
 * once shutdown has started.
 */
export function createShutdownHandler(deps: ShutdownDeps): (signal: string) => Promise<void> {
  let shuttingDown = false;
  const timeoutMs = deps.timeoutMs ?? 10_000;

  return async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.logger.info("shutting down", { signal });

    const timeout = setTimeout(() => {
      deps.logger.error(`[shutdown] did not complete within ${timeoutMs}ms, forcing exit`);
      deps.exit(1);
    }, timeoutMs);
    timeout.unref?.();

    try {
      await deps.closeServer();
      await deps.closeWorker();
      await deps.closeRedis();
      await deps.closeQueueConnection();
      clearTimeout(timeout);
      deps.logger.info("[shutdown] complete");
      deps.exit(0);
    } catch (err) {
      clearTimeout(timeout);
      deps.logger.error("[shutdown] error during shutdown, forcing exit", { error: (err as Error).message });
      deps.exit(1);
    }
  };
}
