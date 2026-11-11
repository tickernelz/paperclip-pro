const EMBEDDED_POSTGRES_EXIT_EVENTS = [
  "exit",
  "beforeExit",
  "SIGHUP",
  "SIGINT",
  "SIGTERM",
  "SIGBREAK",
  "message",
] as const;

type EmbeddedPostgresExitTarget = {
  rawListeners(eventName: string): Function[];
  removeListener(eventName: string, listener: (...args: any[]) => void): unknown;
};

export async function loadWithoutEmbeddedPostgresExitHooks<T>(
  load: () => Promise<T>,
  target: EmbeddedPostgresExitTarget = process,
): Promise<T> {
  const listenersBeforeLoad = new Map(
    EMBEDDED_POSTGRES_EXIT_EVENTS.map((eventName) => [
      eventName,
      target.rawListeners(eventName),
    ]),
  );

  let loaded: T;
  try {
    loaded = await load();
  } finally {
    for (const eventName of EMBEDDED_POSTGRES_EXIT_EVENTS) {
      const remainingBeforeLoad = [...(listenersBeforeLoad.get(eventName) ?? [])];
      for (const listener of target.rawListeners(eventName)) {
        const existingIndex = remainingBeforeLoad.indexOf(listener);
        if (existingIndex >= 0) {
          remainingBeforeLoad.splice(existingIndex, 1);
          continue;
        }
        target.removeListener(eventName, listener as (...args: any[]) => void);
      }
    }
  }

  return loaded;
}
