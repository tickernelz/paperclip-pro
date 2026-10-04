import { describe, expect, it } from "vitest";
import { openwaEndpointPolicySchema, type OpenwaEndpointHealth } from "@tickernelz/paperclip-pro-shared";
import { openwaAuditSearch } from "@/api/chatEndpoints";
import { openwaHealthRows } from "./OpenwaHealthCard";
import {
  openwaCapabilityWarnings,
  apiFieldErrors,
  auditFields,
  chatDraft,
  chatSettingsInput,
  datetimeLocalToIso,
  openwaChatSettingsErrors,
  openwaPolicyPatchErrors,
  wholeNumber,
} from "./openwa-settings-model";
import { ApiError } from "@/api/client";

const policy = openwaEndpointPolicySchema.parse({});

describe("OpenWA audit helpers", () => {
  it("encodes every filter and the cursor into one query string", () => {
    expect(openwaAuditSearch({})).toBe("limit=25");
    const search = new URLSearchParams(
      openwaAuditSearch(
        { kind: "tool_called", actorKind: "agent", chatKey: " 628111@c.us ", from: "2026-10-01T00:00:00.000Z", to: "2026-10-02T00:00:00.000Z" },
        "cursor-1",
      ),
    );
    expect(Object.fromEntries(search)).toEqual({
      limit: "25",
      kind: "tool_called",
      actorKind: "agent",
      chatKey: "628111@c.us",
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-02T00:00:00.000Z",
      cursor: "cursor-1",
    });
  });

  it("flattens metadata into label/value rows and drops empty values", () => {
    expect(auditFields({ tool: "openwa_send", latencyMs: 12, errorCode: null, ids: ["a", "b"], nested: { x: 1 } })).toEqual([
      ["tool", "openwa_send"],
      ["latencyMs", "12"],
      ["ids", "a, b"],
      ["nested", '{"x":1}'],
    ]);
    expect(auditFields(null)).toEqual([]);
  });

  it("converts datetime-local input to ISO and ignores blanks", () => {
    expect(datetimeLocalToIso("")).toBeUndefined();
    expect(datetimeLocalToIso("not a date")).toBeUndefined();
    expect(datetimeLocalToIso("2026-10-03T09:30")).toBe(new Date("2026-10-03T09:30").toISOString());
  });
});

describe("OpenWA settings validation", () => {
  it("reads policy bounds from the shared schema", () => {
    expect(openwaPolicyPatchErrors(policy, { absenceSeconds: 120 })).toBeNull();
    expect(openwaPolicyPatchErrors(policy, { absenceSeconds: 5 })).toHaveProperty("absenceSeconds");
    expect(openwaPolicyPatchErrors(policy, { approvals: { maxReminders: 11 } })).toEqual({ "approvals.maxReminders": "Use at most 10" });
    expect(openwaPolicyPatchErrors(policy, { absenceSeconds: 5 })).toEqual({ absenceSeconds: "Use at least 10" });
    expect(openwaPolicyPatchErrors(policy, { customInstructions: "x".repeat(8001) })).toEqual({ customInstructions: "Use at most 8000 characters" });
    expect(openwaPolicyPatchErrors(policy, { auditContentRetentionDays: wholeNumber("") })).toEqual({ auditContentRetentionDays: "Enter a whole number" });
    expect(openwaPolicyPatchErrors(policy, { customInstructions: "x".repeat(8001) })).toHaveProperty("customInstructions");
    expect(openwaPolicyPatchErrors(policy, { triggers: { ...policy.triggers, commandPrefix: { enabled: true, prefix: "two words" } } })).toHaveProperty([
      "triggers.commandPrefix.prefix",
    ]);
  });

  it("maps server zod issues to field keys", () => {
    const error = new ApiError("Invalid OpenWA policy", 422, {
      error: "Invalid OpenWA policy",
      details: { issues: [{ path: ["approvals", "grantTtlHours"], message: "Too big" }] },
    });
    expect(apiFieldErrors(error)).toEqual({ "approvals.grantTtlHours": "Too big" });
    const zod = new ApiError("Validation error", 400, { details: [{ path: ["settings", "absenceSeconds"], message: "Too small" }] });
    expect(apiFieldErrors(zod, "settings")).toEqual({ absenceSeconds: "Too small" });
    expect(apiFieldErrors(new Error("conflict"))).toEqual({ form: "conflict" });
  });

  it("round-trips per-chat settings and omits inherited values", () => {
    const settings = {
      activation: "on" as const,
      triggers: { directMessage: false, commandPrefix: { enabled: true, prefix: "/bot" }, keywords: ["invoice"] },
      absenceSeconds: 300,
      replyPolicy: "ask_owner" as const,
      note: "VIP customer",
    };
    expect(chatSettingsInput(chatDraft("Ops", settings))).toEqual(settings);
    expect(chatSettingsInput(chatDraft("Ops", { activation: "auto" }))).toEqual({ activation: "auto" });
    expect(openwaChatSettingsErrors({ activation: "on", absenceSeconds: 3 })).toHaveProperty("absenceSeconds");
    expect(openwaChatSettingsErrors(settings)).toBeNull();
  });
});

describe("OpenWA health and capability warnings", () => {
  const health: OpenwaEndpointHealth = {
    gatewayVersion: "0.23.7",
    pinnedVersion: "0.23.7",
    engine: "whatsapp-web.js",
    session: { status: "ready", maskedNumber: "+62xxx...5678", restriction: null },
    pacing: { attested: true, observedAt: null },
    adminKeyConfigured: false,
    gatewayError: null,
    checkedAt: "2026-10-03T00:00:00.000Z",
  };

  it("labels pacing as attested until a limit is observed", () => {
    const rows = Object.fromEntries(openwaHealthRows(health).map((row) => [row.label, row]));
    expect(rows.Pacing.value).toBe("Attested · not yet observed");
    expect(rows.Session.value).toBe("ready · +62xxx...5678");
    expect(rows.Restriction.value).toBe("None");
    const observed = Object.fromEntries(
      openwaHealthRows({
        ...health,
        gatewayVersion: "0.24.0",
        session: { status: "disconnected", maskedNumber: null, restriction: { active: true, kind: "spam", expiresAt: null } },
        pacing: { attested: true, observedAt: "2026-10-03T01:00:00.000Z" },
      }).map((row) => [row.label, row]),
    );
    expect(observed.Pacing.value).toMatch(/^Observed · last limited /);
    expect(observed["Gateway version"].attention).toBe(true);
    expect(observed.Session.attention).toBe(true);
    expect(observed.Restriction).toMatchObject({ value: "Active (spam)", attention: true });
  });

  it("warns about steering and instruction-only read-only runs per adapter", () => {
    const base = { adapterConfig: {}, inflightMode: "steer" as const, numberMode: "agent_number" as const };
    expect(openwaCapabilityWarnings({ ...base, adapterType: "omp_local", supportsLiveSteering: true, readOnlyToolProfile: "enforced" })).toEqual([]);
    const claude = openwaCapabilityWarnings({ ...base, adapterType: "claude_local", supportsLiveSteering: false, readOnlyToolProfile: "enforced" });
    expect(claude).toHaveLength(1);
    expect(claude[0]).toContain("cannot steer");
    const gemini = openwaCapabilityWarnings({ ...base, adapterType: "gemini_local", supportsLiveSteering: false, readOnlyToolProfile: "instruction_only" });
    expect(gemini[1]).toContain("instruction-only for the gemini_local adapter");
    const rpcOff = openwaCapabilityWarnings({ ...base, adapterType: "omp_local", adapterConfig: { rpcSteering: false }, supportsLiveSteering: true, readOnlyToolProfile: "enforced" });
    expect(rpcOff[0]).toContain("live session (RPC) transport is off");
    expect(openwaCapabilityWarnings({ ...base, inflightMode: "queue", adapterType: "omp_local", supportsLiveSteering: true, readOnlyToolProfile: "enforced" })[0]).toContain("queue");
  });
});
