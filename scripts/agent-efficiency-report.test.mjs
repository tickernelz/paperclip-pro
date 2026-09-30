import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  analyzeRunLog,
  createFrameParser,
  isLoopRun,
  normalizeErrorMessage,
  parseApiError,
  scrubSecrets,
} from "./agent-efficiency-report.mjs";

function frameLine(frame, seq) {
  return JSON.stringify({ ts: "2026-09-30T00:00:00.000Z", stream: "stdout", chunk: `${JSON.stringify(frame)}\n`, seq });
}

function withRunLog(lines, callback) {
  const dir = mkdtempSync(join(tmpdir(), "agent-efficiency-"));
  const file = join(dir, "run.ndjson");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return Promise.resolve(callback(file)).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function bashStart(id, args) {
  return { type: "tool_execution_start", toolCallId: id, toolName: "bash", args };
}

test("frame parser reassembles a frame split across stdout chunks and skips non-JSON noise", () => {
  const parser = createFrameParser();
  const frame = JSON.stringify({ type: "tool_execution_start", toolName: "read", args: { path: "a" } });
  assert.deepEqual(parser.push("warning: not json\n"), []);
  assert.deepEqual(parser.push(frame.slice(0, 20)), []);
  assert.equal(parser.pending, true);
  const frames = parser.push(`${frame.slice(20)}\n{"type":"agent_end"}\n`);
  assert.deepEqual(frames.map((entry) => entry.type), ["tool_execution_start", "agent_end"]);
  assert.equal(frames[0].args.path, "a");
});

test("API errors collapse to status, normalized route and machine code", () => {
  const text =
    'Error: {"error":"PATCH /issues/ZHA-143 failed with 422: agent_review_handoff_requires_subtask: Agents cannot hand this task","status":422,"method":"PATCH","path":"/issues/ZHA-143","body":{"error":"agent_review_handoff_requires_subtask: Agents cannot hand this task","code":"agent_review_handoff_requires_subtask"}}';
  const other = text.replaceAll("ZHA-143", "e7acfd99-d8eb-4e4b-881e-f40d37e0db82");
  assert.deepEqual(parseApiError(text), {
    status: 422,
    method: "PATCH",
    route: "/issues/:id",
    code: "agent_review_handoff_requires_subtask",
  });
  assert.equal(normalizeErrorMessage(text), normalizeErrorMessage(other));
  assert.equal(normalizeErrorMessage(text), "HTTP 422 PATCH /issues/:id: agent_review_handoff_requires_subtask");
});

test("volatile ids, paths and python tracebacks normalize to one bucket", () => {
  const a = "Path not found: /tmp/paperclip-run-zha-141-84495b02/src/firefox/dom/webidl";
  const b = "Path not found: /tmp/paperclip-run-zha-150-aaaa/src/other.json";
  assert.equal(normalizeErrorMessage(a), normalizeErrorMessage(b));
  const traceback = 'Traceback (most recent call last):\n  File "<cell>", line 2, in <module>\nKeyError: \'PAPERCLIP_RUN_SCRATCH_DIR\'\n\nCommand exited with code 1';
  assert.equal(normalizeErrorMessage(traceback), "[exit 1] KeyError: 'PAPERCLIP_RUN_SCRATCH_DIR'");
});

test("run analyzer counts async bash hygiene, repeats, timeouts, kills and service rejects", async () => {
  const relaunch = { command: "./gate.sh", async: true, ready: {}, i: "Running gate" };
  const lines = [
    frameLine(bashStart("t1", relaunch), 1),
    frameLine({ type: "message_update", assistantMessageEvent: { type: "text_delta" } }, 2),
    frameLine(bashStart("t2", { ...relaunch, i: "Rerunning gate" }), 3),
    frameLine(bashStart("t3", { ...relaunch, i: "Again" }), 4),
    frameLine(
      {
        type: "message_end",
        message: {
          role: "custom",
          customType: "async-result",
          content: "Background job bg_2 has completed.\nError: [Command timed out after 300 seconds]",
        },
      },
      5,
    ),
    frameLine(bashStart("t4", { command: "sleep 1", async: true, timeout: 900 }), 6),
    frameLine(bashStart("t5", { command: "srv", name: "svc", async: true }), 7),
    frameLine(
      {
        type: "tool_execution_end",
        toolCallId: "t5",
        toolName: "bash",
        isError: true,
        result: { content: [{ type: "text", text: "Service mode does not accept async or timeout; use ready.timeout for readiness." }] },
      },
      8,
    ),
    frameLine({ type: "tool_execution_start", toolCallId: "t6", toolName: "read", args: { path: "proc://bg_1/kill" } }, 9),
    frameLine({ type: "message_end", message: { role: "assistant", provider: "sub2api", model: "claude-opus-5-5", content: [] } }, 10),
  ];
  const stats = await withRunLog(lines, (file) => analyzeRunLog(file));
  assert.equal(stats.toolCalls, 6);
  assert.equal(stats.asyncBash, 5);
  assert.equal(stats.asyncWithTimeout, 1);
  assert.equal(stats.asyncWithoutTimeout, 4);
  assert.equal(stats.asyncEmptyReady, 3);
  assert.equal(stats.repeatedStreaks.length, 1);
  assert.equal(stats.repeatedStreaks[0].length, 3);
  assert.equal(stats.repeatedExtraCalls, 2);
  assert.equal(stats.relaunches, 2);
  assert.equal(stats.asyncTimedOut.get("bg_2"), 300);
  assert.equal(stats.serviceModeRejects, 1);
  assert.equal(stats.killCalls, 1);
  assert.equal(stats.toolErrors, 1);
  assert.deepEqual([...stats.models.keys()], ["sub2api/claude-opus-5-5"]);
  assert.equal(isLoopRun(stats), true);
});

test("secrets in commands, call args and error text never reach the report", async () => {
  const apiKey = "pcp_3f9a0c1d2e4b5a6978c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4";
  const entropy = "Zq8vN2kP7xR4mT9wL3bY6cH1jD5fG0sAeU";
  const secrets = [apiKey, "hunter2pass", "s3cr3t-db", "opaqueheadervalue77", entropy, "dXNlcjpwYXNzd29yZA=="];
  const command = [
    `PGPASSWORD=s3cr3t-db psql -h 127.0.0.1 --password=hunter2pass`,
    `curl -H 'Authorization: Bearer ${apiKey}' -H 'X-Api-Key: opaqueheadervalue77'`,
    `-H "Authorization: Basic dXNlcjpwYXNzd29yZA==" --data ${entropy}`,
  ].join(" && ");
  const call = { command, async: true, i: "Probing" };
  const lines = [
    frameLine(bashStart("t1", call), 1),
    frameLine(bashStart("t2", call), 2),
    frameLine(bashStart("t3", call), 3),
    frameLine(
      {
        type: "tool_execution_end",
        toolCallId: "t3",
        toolName: "bash",
        isError: true,
        result: { content: [{ type: "text", text: `curl: (22) auth failed for token=${apiKey} ${entropy}` }] },
      },
      4,
    ),
  ];
  const stats = await withRunLog(lines, (file) => analyzeRunLog(file));
  const rendered = JSON.stringify({
    streaks: stats.repeatedStreaks,
    relaunched: [...stats.relaunchedCommands.keys()],
    errors: [...stats.errorMessages.keys()],
  });
  assert.equal(stats.repeatedStreaks.length, 1);
  assert.equal(stats.relaunchedCommands.size, 1);
  for (const secret of secrets) assert.equal(rendered.includes(secret), false, secret);
  assert.match(rendered, /\[REDACTED\]/);
  const benign = "cd /home/zhafron/Projects/paperclip-pro && pnpm vitest run src/__tests__/issue-create-deduplication-routes.test.ts";
  assert.equal(scrubSecrets(benign), benign);
});
