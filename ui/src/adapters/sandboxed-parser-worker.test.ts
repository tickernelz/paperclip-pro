import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";

import { getWorkerBootstrapSource } from "./sandboxed-parser-worker";

const HOST_SCRIPT = `
const { parentPort, workerData } = require("node:worker_threads");

const self = {};
for (const name of ["caches", "indexedDB", "navigator", "location", "crossOriginIsolated"]) {
  Object.defineProperty(self, name, { get: () => undefined, enumerable: true, configurable: false });
}
self.URL = { createObjectURL() {}, revokeObjectURL() {} };
self.postMessage = (message) => { parentPort.postMessage(message); };

let booted = false;
try {
  new Function("self", workerData.bootstrap)(self);
  booted = true;
} catch (err) {
  parentPort.postMessage({ type: "bootstrap-error", message: String((err && err.message) || err) });
}

if (booted) {
  parentPort.postMessage({ type: "bootstrap-ok" });
  parentPort.on("message", (message) => {
    if (message && message.type === "__probe") {
      const denied = {};
      for (const name of message.names) denied[name] = self[name] === undefined;
      parentPort.postMessage({ type: "probe", denied });
      return;
    }
    self.onmessage({ data: message });
  });
}
`;

const PARSER_SOURCE = `
exports.parseStdoutLine = function (line, ts) {
  return [{ kind: "text", text: line.toUpperCase(), ts: ts }];
};
`;

interface WorkerHandle {
  send: (message: unknown) => void;
  next: () => Promise<any>;
  dispose: () => Promise<void>;
}

function bootWorker(): WorkerHandle {
  const worker = new Worker(HOST_SCRIPT, {
    eval: true,
    workerData: { bootstrap: getWorkerBootstrapSource() },
  });
  const inbox: any[] = [];
  const waiters: Array<(message: any) => void> = [];

  worker.on("message", (message) => {
    const waiter = waiters.shift();
    if (waiter) waiter(message);
    else inbox.push(message);
  });

  return {
    send: (message) => worker.postMessage(message),
    next: () =>
      new Promise((resolve, reject) => {
        if (inbox.length > 0) {
          resolve(inbox.shift());
          return;
        }
        const timer = setTimeout(() => reject(new Error("timed out waiting for a worker message")), 5000);
        waiters.push((message) => {
          clearTimeout(timer);
          resolve(message);
        });
      }),
    dispose: async () => {
      await worker.terminate();
    },
  };
}

describe("sandboxed parser worker bootstrap", () => {
  it("survives getter-only WorkerGlobalScope accessors", async () => {
    const handle = bootWorker();
    try {
      await expect(handle.next()).resolves.toEqual({ type: "bootstrap-ok" });
    } finally {
      await handle.dispose();
    }
  });

  it("becomes ready and parses lines through the injected parser", async () => {
    const handle = bootWorker();
    try {
      expect(await handle.next()).toEqual({ type: "bootstrap-ok" });

      handle.send({ type: "init", source: PARSER_SOURCE });
      expect(await handle.next()).toEqual({ type: "ready" });

      handle.send({ type: "parse", id: 7, line: "hello", ts: "2026-01-01T00:00:00.000Z" });
      expect(await handle.next()).toEqual({
        type: "result",
        id: 7,
        entries: [{ kind: "text", text: "HELLO", ts: "2026-01-01T00:00:00.000Z" }],
      });
    } finally {
      await handle.dispose();
    }
  });

  it("denies network, import and storage globals inside the sandbox", async () => {
    const handle = bootWorker();
    try {
      expect(await handle.next()).toEqual({ type: "bootstrap-ok" });

      const names = [
        "fetch",
        "XMLHttpRequest",
        "WebSocket",
        "EventSource",
        "RTCPeerConnection",
        "RTCDataChannel",
        "importScripts",
        "Worker",
        "SharedWorker",
        "Blob",
        "BroadcastChannel",
        "caches",
        "indexedDB",
        "IDBFactory",
      ];
      handle.send({ type: "__probe", names });
      const reply = await handle.next();

      expect(reply.type).toBe("probe");
      expect(Object.entries(reply.denied).filter(([, denied]) => !denied)).toEqual([]);
    } finally {
      await handle.dispose();
    }
  });

  it("reports an error when the parser source exports nothing usable", async () => {
    const handle = bootWorker();
    try {
      expect(await handle.next()).toEqual({ type: "bootstrap-ok" });

      handle.send({ type: "init", source: "var unused = 1;" });
      const reply = await handle.next();

      expect(reply.type).toBe("error");
      expect(reply.message).toContain("no usable parseStdoutLine");
    } finally {
      await handle.dispose();
    }
  });
});
