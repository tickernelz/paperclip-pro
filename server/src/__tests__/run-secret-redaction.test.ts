import { beforeEach, describe, expect, it, vi } from "vitest";
import { REDACTED_EVENT_VALUE } from "../redaction.js";
import type { Db } from "@tickernelz/wardmote-db";
import { PgDialect } from "drizzle-orm/pg-core";
import { createRunSecretRedactionRegistry, redactRegisteredSecretValues } from "../services/run-secret-redaction.js";

const secret = "q2a-exact-secret-value";

describe("registered run secret redaction", () => {
  it("strips private credential fields and denies names unless the caller supplies an authorized projection", () => {
    const input = { resultJson: { configurationIncomplete: {
      credentialAccess: { connectionName: "private name", grantId: "private grant", secret: "private value" },
    } } };
    expect(redactRegisteredSecretValues(input, []).resultJson.configurationIncomplete.credentialAccess).toEqual({});
    expect(redactRegisteredSecretValues(input, [], "Visible name").resultJson.configurationIncomplete.credentialAccess).toEqual({ connectionName: "Visible name" });
    expect(redactRegisteredSecretValues(input, ["Visible name"], "Visible name").resultJson.configurationIncomplete.credentialAccess).toEqual({ connectionName: REDACTED_EVENT_VALUE });
  });
  it("redacts exact values across comment and heartbeat/wake projections", () => {
    const result = redactRegisteredSecretValues({
      comment: { body: `agent pasted ${secret} in a comment` },
      heartbeatContext: {
        issue: { description: `do not expose ${secret}` },
        wakeComment: { body: secret },
      },
      wakePayload: {
        comments: [{ body: `prefix-${secret}-suffix` }],
        continuationSummary: { body: secret },
      },
    }, [secret]);

    expect(result).toEqual({
      comment: { body: `agent pasted ${REDACTED_EVENT_VALUE} in a comment` },
      heartbeatContext: {
        issue: { description: `do not expose ${REDACTED_EVENT_VALUE}` },
        wakeComment: { body: REDACTED_EVENT_VALUE },
      },
      wakePayload: {
        comments: [{ body: `prefix-${REDACTED_EVENT_VALUE}-suffix` }],
        continuationSummary: { body: REDACTED_EVENT_VALUE },
      },
    });
  });

  it("redacts run detail, event, and transcript fields and strips registry material", () => {
    const result = redactRegisteredSecretValues({
      contextSnapshot: {
        issueId: "issue-1",
        wardmoteSecretRedactions: [{ material: { ciphertext: "encrypted" } }],
      },
      stdoutExcerpt: `stdout ${secret}`,
      events: [{ message: secret, payload: { output: secret } }],
      log: { content: `tool returned ${secret}` },
    }, [secret]);

    expect(result).toEqual({
      contextSnapshot: { issueId: "issue-1" },
      stdoutExcerpt: `stdout ${REDACTED_EVENT_VALUE}`,
      events: [{ message: REDACTED_EVENT_VALUE, payload: { output: REDACTED_EVENT_VALUE } }],
      log: { content: `tool returned ${REDACTED_EVENT_VALUE}` },
    });
  });

  it("replaces longer registered values before overlapping shorter values", () => {
    expect(redactRegisteredSecretValues("token-extended token", ["token-extended", "token"]))
      .toBe(`${REDACTED_EVENT_VALUE} ${REDACTED_EVENT_VALUE}`);
  });

  it("preserves Date instances instead of collapsing them to empty objects (PAP-16607)", () => {
    const createdAt = new Date("2026-08-06T12:00:00.000Z");
    const result = redactRegisteredSecretValues({
      comment: { body: `agent pasted ${secret}`, createdAt, updatedAt: createdAt },
      nested: [{ finishedAt: createdAt }],
    }, [secret]);

    expect(result.comment.createdAt).toBeInstanceOf(Date);
    expect(result.comment.createdAt.toISOString()).toBe("2026-08-06T12:00:00.000Z");
    expect(result.comment.updatedAt).toBeInstanceOf(Date);
    expect(result.nested[0]?.finishedAt).toBeInstanceOf(Date);
    expect(result.comment.body).toBe(`agent pasted ${REDACTED_EVENT_VALUE}`);
  });

  it("preserves Date instances when no secret values are registered", () => {
    const createdAt = new Date("2026-08-06T12:00:00.000Z");
    const result = redactRegisteredSecretValues({ createdAt }, []);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toBe("2026-08-06T12:00:00.000Z");
  });
});

const { resolveVersion } = vi.hoisted(() => ({ resolveVersion: vi.fn(async ({ material }) => material.value as string) }));
vi.mock("../secrets/provider-registry.js", () => ({ getSecretProvider: () => ({ resolveVersion }) }));
const { savedSpeechToTextKeys } = vi.hoisted(() => ({ savedSpeechToTextKeys: { current: {} as Record<string, string> } }));
vi.mock("../services/speech-to-text-keys.js", () => ({ readSpeechToTextApiKeys: async () => savedSpeechToTextKeys.current }));

describe("batched run secret redaction", () => {
  beforeEach(() => {
    resolveVersion.mockClear();
    savedSpeechToTextKeys.current = {};
  });

  it("redacts the saved speech-to-text keys from every run, issue and single-run projection", async () => {
    savedSpeechToTextKeys.current = { deepgram: "dg-saved-zha6141-key", elevenlabs: "el-saved-zha6141-key" };
    const rows = [{ id: "a", contextSnapshot: { wardmoteSecretRedactions: [{ fingerprintSha256: "one", material: { value: secret } }] } }];
    const { registry } = fixture(rows);
    expect(await registry.redactForRuns("company", [
      { id: "a", text: secret + " dg-saved-zha6141-key" },
      { id: "b", text: "pasted el-saved-zha6141-key" },
    ])).toEqual([
      { id: "a", text: REDACTED_EVENT_VALUE + " " + REDACTED_EVENT_VALUE },
      { id: "b", text: "pasted " + REDACTED_EVENT_VALUE },
    ]);
    expect(await registry.redactForRun("company", "a", { log: "dg-saved-zha6141-key" })).toEqual({ log: REDACTED_EVENT_VALUE });
    expect(await registry.redactForIssue("company", "issue-1", "el-saved-zha6141-key")).toBe(REDACTED_EVENT_VALUE);
  });

  it("leaves ordinary text alone when a saved speech-to-text key is a short placeholder", async () => {
    const body = "Transcription is none yet; the endpoint needs no key, so none was set.";
    savedSpeechToTextKeys.current = { openai_compatible: "none", deepgram: "x".repeat(15), elevenlabs: "el-saved-zha6141-key" };
    const { registry } = fixture([{ id: "a", contextSnapshot: {} }]);
    expect(await registry.redactForRuns("company", [{ id: "a", body: body + " " + "x".repeat(15) }])).toEqual([{ id: "a", body: body + " " + "x".repeat(15) }]);
    expect(await registry.redactForRun("company", "a", { body })).toEqual({ body });
    expect(await registry.redactForIssue("company", "issue-1", body + " el-saved-zha6141-key")).toBe(body + " " + REDACTED_EVENT_VALUE);
  });

  function fixture(rows: unknown[]) {
    const where = vi.fn(async (_predicate: import("drizzle-orm").SQL | undefined) => rows);
    const select = vi.fn((_columns: { contextSnapshot: import("drizzle-orm").SQL }) => ({ from: () => ({ where }) }));
    return { registry: createRunSecretRedactionRegistry({ select } as unknown as Db), select, where };
  }

  it("reads only registry JSON once for 200 runs and resolves shared secrets once", async () => {
    const contextSnapshot = { wardmoteSecretRedactions: [{ fingerprintSha256: "shared", material: { value: secret } }] };
    const rows = Array.from({ length: 200 }, (_, i) => ({ id: `run-${i}`, contextSnapshot }));
    const { registry, select, where } = fixture(rows);
    const result = await registry.redactForRuns("company-1", rows.map(row => ({ ...row, stdoutExcerpt: secret })));
    expect(select).toHaveBeenCalledTimes(1);
    expect(resolveVersion).toHaveBeenCalledTimes(1);
    expect(result.every(run => run.stdoutExcerpt === REDACTED_EVENT_VALUE)).toBe(true);
    expect(result[0].contextSnapshot).toEqual({});
    const dialect = new PgDialect();
    const predicate = dialect.sqlToQuery(where.mock.calls[0][0]);
    expect(predicate.params).toContain("company-1");
    expect(predicate.sql).toContain('"company_id"');
    expect(predicate.sql).toContain("\"context_snapshot\" ? 'wardmoteSecretRedactions'");
    expect(dialect.sqlToQuery(select.mock.calls[0][0].contextSnapshot).sql).toContain("-> 'wardmoteSecretRedactions'");
  });

  it("keeps each run's registry separate and observes new registrations on the next request", async () => {
    const rows = [{ id: "a", contextSnapshot: { wardmoteSecretRedactions: [{ fingerprintSha256: "one", material: { value: secret } }] } }];
    const { registry } = fixture(rows);
    expect(await registry.redactForRuns("company", [{ id: "a", text: secret }, { id: "b", text: secret }]))
      .toEqual([{ id: "a", text: REDACTED_EVENT_VALUE }, { id: "b", text: secret }]);
    rows[0].contextSnapshot.wardmoteSecretRedactions.push({ fingerprintSha256: "two", material: { value: "new-secret" } });
    expect(await registry.redactForRuns("company", [{ id: "a", text: "new-secret" }]))
      .toEqual([{ id: "a", text: REDACTED_EVENT_VALUE }]);
  });

  it("looks up issue registries through the issue id and registry presence only", async () => {
    const { registry, where } = fixture([]);
    expect(await registry.redactForIssue("company-1", "issue-1", "plain")).toBe("plain");
    const predicate = new PgDialect().sqlToQuery(where.mock.calls[0][0]);
    expect(predicate.sql).toContain("->> 'issueId' = $");
    expect(predicate.sql).toContain("\"context_snapshot\" ? 'wardmoteSecretRedactions'");
    expect(predicate.sql).not.toContain("wardmoteIssue");
    expect(predicate.sql).not.toMatch(/\bor\b/i);
  });

  it("does not query for an empty list and fails closed on decryption failure", async () => {
    const { registry, select } = fixture([{ id: "a", contextSnapshot: { wardmoteSecretRedactions: [{ fingerprintSha256: "one", material: {} }] } }]);
    expect(await registry.redactForRuns("company", [])).toEqual([]);
    expect(select).not.toHaveBeenCalled();
    resolveVersion.mockRejectedValueOnce(new Error("unavailable"));
    await expect(registry.redactForRuns("company", [{ id: "a", text: secret }])).rejects.toThrow("unavailable");
  });
});
