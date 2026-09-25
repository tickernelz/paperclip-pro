import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isOmpStartupComplete } from "@tickernelz/paperclip-pro-adapter-omp-local/server";
import {
  clearLocalCliRunStarting,
  reportsStartupComplete,
} from "../services/heartbeat.ts";

const adapter = { isStartupComplete: isOmpStartupComplete };
const SESSION = '{"type":"session","version":3,"id":"01a0d6d4","cwd":"/tmp"}';
const NOTICE = '{"type":"notice","level":"info","message":"xd://: unmounted"}';
const AGENT_START = '{"type":"agent_start"}';

describe("local CLI startup signal line framing", () => {
  it("detects a startup record split across two stdout chunks", () => {
    const runId = randomUUID();
    expect(reportsStartupComplete(adapter, '{"type":"agent_', runId)).toBe(
      false,
    );
    expect(reportsStartupComplete(adapter, 'start"}\n', runId)).toBe(true);
  });

  it("detects a startup record sharing a chunk with the session record", () => {
    const runId = randomUUID();
    expect(
      reportsStartupComplete(
        adapter,
        `${SESSION}\n${NOTICE}\n${AGENT_START}\n`,
        runId,
      ),
    ).toBe(true);
  });

  it("carries a partial record forward without signalling early", () => {
    const runId = randomUUID();
    expect(reportsStartupComplete(adapter, '{"type":"ses', runId)).toBe(false);
    expect(
      reportsStartupComplete(adapter, `sion","id":"01a0"}\n${NOTICE}\n`, runId),
    ).toBe(false);
    expect(reportsStartupComplete(adapter, `${AGENT_START}\n`, runId)).toBe(
      true,
    );
  });

  it("buffers each run's partial line separately", () => {
    const first = randomUUID();
    const second = randomUUID();
    expect(reportsStartupComplete(adapter, '{"type":"agent_', first)).toBe(
      false,
    );
    expect(reportsStartupComplete(adapter, 'start"}\n', second)).toBe(false);
    expect(reportsStartupComplete(adapter, 'start"}\n', first)).toBe(true);
  });

  it("drops the buffered remainder when the run settles", () => {
    const runId = randomUUID();
    expect(reportsStartupComplete(adapter, '{"type":"agent_', runId)).toBe(
      false,
    );
    clearLocalCliRunStarting(runId);
    expect(reportsStartupComplete(adapter, 'start"}\n', runId)).toBe(false);
  });

  it("treats an adapter without a startup predicate as started", () => {
    expect(reportsStartupComplete({}, '{"type":"ses', randomUUID())).toBe(true);
  });
});
