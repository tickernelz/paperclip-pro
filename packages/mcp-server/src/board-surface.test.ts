import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS,
  agentAuthorityCapabilities,
} from "@tickernelz/paperclip-pro-shared";
import {
  ACTOR_NEUTRAL_GUARDS,
  AGENT_ADMITTING_GUARDS,
  BOARD_ONLY_GUARDS,
  boardToolAdvertised,
  classifiedGuards,
  type BoardSurfaceContext,
} from "./board-surface.js";
import { generatedToolSpecs, type GeneratedToolSpec } from "./generated-tools.js";

const GUARD_DIRS = [
  new URL("../../../server/src/routes/", import.meta.url),
  new URL("../../../server/src/services/", import.meta.url),
];

function routeSource(): string {
  return GUARD_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => readFileSync(new URL(name, dir), "utf8")),
  ).join("\n");
}

const CEO: BoardSurfaceContext = {
  capabilities: agentAuthorityCapabilities("ceo"),
  permissionKeys: new Set(),
};

function probeOnlyBoardSpecs() {
  return generatedToolSpecs().filter(
    (spec) => spec.authority === "board" && (spec.boardGuard ?? "").startsWith("probe:"),
  );
}

function grantsAdmitActor(
  spec: Pick<
    GeneratedToolSpec,
    "authorityCapability" | "guards" | "permissions"
  >,
  context: BoardSurfaceContext,
): boolean {
  if (spec.guards.some((guard) => BOARD_ONLY_GUARDS[guard] === true)) return false;
  if (!spec.guards.some((guard) => AGENT_ADMITTING_GUARDS[guard] === true)) return false;
  const capability = spec.authorityCapability;
  if (capability != null && !context.capabilities.includes(capability)) return false;
  return spec.permissions.every(
    (key) =>
      context.permissionKeys.has(key) ||
      (AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS.includes(key) &&
        context.capabilities.includes("company:members")),
  );
}

function actorHoldingEverything(spec: Pick<GeneratedToolSpec, "authorityCapability" | "permissions">) {
  return {
    capabilities: spec.authorityCapability == null
      ? CEO.capabilities
      : [...CEO.capabilities, spec.authorityCapability],
    permissionKeys: new Set(spec.permissions),
  } satisfies BoardSurfaceContext;
}

describe("board surface classification", () => {
  it("classifies every guard that can decide whether a board tool is advertised", () => {
    const classified = new Set(classifiedGuards());
    const seen = new Set<string>();
    for (const spec of generatedToolSpecs()) {
      if (spec.authority !== "board") continue;
      for (const guard of spec.guards) {
        if (!classified.has(guard)) seen.add(guard);
      }
    }
    expect([...seen].sort()).toEqual([]);
  });

  it("names guards that exist in the route source", () => {
    const source = routeSource();
    const missing = classifiedGuards().filter(
      (guard) => !source.includes(`function ${guard}(`) && !source.includes(`const ${guard} =`),
    );
    expect(missing).toEqual([]);
  });

  it("classifies each guard exactly once", () => {
    const groups = [
      Object.keys(AGENT_ADMITTING_GUARDS),
      Object.keys(BOARD_ONLY_GUARDS),
      Object.keys(ACTOR_NEUTRAL_GUARDS),
    ];
    const all = groups.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it("records only capabilities the agent authority list can grant", () => {
    const source = readFileSync(
      new URL("../../../packages/shared/src/agent-authority.ts", import.meta.url),
      "utf8",
    );
    for (const spec of generatedToolSpecs()) {
      if (spec.authorityCapability === null) continue;
      expect(source).toContain(`"${spec.authorityCapability}"`);
    }
  });

  it("records a capability only where the handler asserts an authority guard", () => {
    const authorityGuards = [
      "assertAgentAuthority",
      "assertBoardOrAgentAuthority",
      "assertBoardOrgOrAgentAuthority",
    ];
    for (const spec of generatedToolSpecs()) {
      if (spec.authorityCapability === null) continue;
      expect(spec.guards.some((guard) => authorityGuards.includes(guard))).toBe(true);
    }
  });
});

describe("boardToolAdvertised", () => {
  const spec = (overrides: Record<string, unknown>) =>
    ({
      operationId: "GET /api/x",
      authority: "board",
      authorityCapability: null,
      authoritySource: "default",
      guards: [],
      permissions: [],
      boardGuard: null,
      ...overrides,
    }) as never;

  it("advertises non-board tools regardless of grants", () => {
    expect(
      boardToolAdvertised(spec({ authority: "agent" }), { capabilities: [], permissionKeys: new Set() }),
    ).toBe(true);
  });

  it("withholds a board tool whose handler asserts a board-only guard", () => {
    expect(
      boardToolAdvertised(
        spec({
          authoritySource: "handler",
          guards: ["assertBoard"],
          boardGuard: "assertBoard@chat-channels.ts:1",
        }),
        CEO,
      ),
    ).toBe(false);
  });

  it("withholds a board tool whose handler guards no agent past, even with a granting capability", () => {
    expect(
      boardToolAdvertised(
        spec({
          authoritySource: "handler",
          guards: ["assertSameCompanyCeoAgentOrBoard"],
          authorityCapability: "company:settings",
          boardGuard: "assertSameCompanyCeoAgentOrBoard@export.ts:1",
        }),
        CEO,
      ),
    ).toBe(false);
  });

  it("withholds a board tool that no agent-admitting guard reaches", () => {
    expect(boardToolAdvertised(spec({ guards: ["assertAuthenticated"] }), CEO)).toBe(false);
  });

  it("advertises a board tool the agent authority guard reaches", () => {
    expect(boardToolAdvertised(spec({ guards: ["assertBoardOrAgentAuthority"] }), CEO)).toBe(true);
  });

  it("withholds a board tool whose recorded capability the actor lacks", () => {
    const tool = spec({ guards: ["assertBoardOrAgentAuthority"], authorityCapability: "company:agents" });
    expect(boardToolAdvertised(tool, CEO)).toBe(true);
    expect(
      boardToolAdvertised(tool, {
        capabilities: ["work:read", "work:issues", "work:routines"],
        permissionKeys: new Set(),
      }),
    ).toBe(false);
  });

  it("withholds a board tool whose permission key the actor lacks", () => {
    const tool = spec({ guards: ["assertCompanyPermission"], permissions: ["users:manage_permissions"] });
    expect(
      boardToolAdvertised(tool, {
        capabilities: CEO.capabilities,
        permissionKeys: new Set(["users:manage_permissions"]),
      }),
    ).toBe(true);
    expect(
      boardToolAdvertised(tool, { capabilities: CEO.capabilities, permissionKeys: new Set() }),
    ).toBe(false);
  });

  it("honours the implicit member grant the permission guard really allows", () => {
    const tool = spec({ guards: ["assertCompanyPermission"], permissions: ["users:invite"] });
    expect(boardToolAdvertised(tool, CEO)).toBe(true);
    expect(
      boardToolAdvertised(tool, {
        capabilities: CEO.capabilities.filter((capability) => capability !== "company:members"),
        permissionKeys: new Set(),
      }),
    ).toBe(false);
  });

  it("keeps the implicit member keys in step with the shared list", () => {
    expect([...AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS]).toContain("users:invite");
  });
});

describe("probe-derived board evidence", () => {
  it("records the probe reason as evidence about the probe actor, never as a board guard", () => {
    for (const spec of probeOnlyBoardSpecs()) {
      expect(spec.authoritySource).toBe("probe");
      expect(spec.boardGuard).toMatch(/^probe:/);
    }
  });

  it("advertises a ceo the export-fidelity tool a ceo agent really reaches", () => {
    const spec = generatedToolSpecs().find(
      (entry) => entry.name === "paperclipGetExportFidelity",
    );
    expect(spec).toBeDefined();
    expect(spec!.guards).toContain("assertSameCompanyCeoAgentOrBoard");
    expect(boardToolAdvertised(spec!, CEO)).toBe(true);
  });

  it("keeps a probe-only tool that no agent-admitting guard reaches hidden", () => {
    const spec = generatedToolSpecs().find(
      (entry) => entry.name === "paperclipListIssueFeedbackTraces",
    );
    expect(spec).toBeDefined();
    expect(spec!.boardGuard).toMatch(/^probe:/);
    expect(spec!.guards).toEqual([]);
    expect(boardToolAdvertised(spec!, CEO)).toBe(false);
  });

  it("decides every probe-only board tool from its recorded guards alone", () => {
    const specs = probeOnlyBoardSpecs();
    expect(specs.length).toBe(19);
    for (const spec of specs) {
      const actor = actorHoldingEverything(spec);
      expect(boardToolAdvertised(spec, actor), spec.name).toBe(grantsAdmitActor(spec, actor));
    }
  });

  it("advertises exactly the probe-only board tools a ceo really reaches", () => {
    const advertised = probeOnlyBoardSpecs()
      .filter((spec) => boardToolAdvertised(spec, CEO))
      .map((spec) => spec.name)
      .sort();
    expect(advertised).toEqual([
      "paperclipGetExportFidelity",
      "paperclipGetUserMeInboxAgentPolicy",
      "paperclipListAgentConfigurations",
    ]);
  });
});

describe("board pruning effect", () => {
  it("drops the bulk of the board-authority surface for a ceo actor", () => {
    const board = generatedToolSpecs().filter((spec) => spec.authority === "board");
    const advertised = board.filter((spec) => boardToolAdvertised(spec, CEO));
    expect(board.length).toBeGreaterThan(250);
    expect(advertised.length).toBeLessThan(40);
    const before = JSON.stringify(board).length;
    const after = JSON.stringify(advertised).length;
    expect(after / before).toBeLessThan(0.15);
  });

  it("grows the ceo listing by exactly the probe-only tools its own guards admit", () => {
    const board = generatedToolSpecs().filter((spec) => spec.authority === "board");
    const advertised = board.filter((spec) => boardToolAdvertised(spec, CEO));
    const fromProbe = advertised.filter((spec) => (spec.boardGuard ?? "").startsWith("probe:"));
    const fromRegistry = advertised.filter((spec) => spec.authoritySource === "registry");
    expect(advertised.length).toBe(fromProbe.length + fromRegistry.length);
    expect(fromProbe.map((spec) => spec.name).sort()).toEqual(
      probeOnlyBoardSpecs()
        .filter((spec) => grantsAdmitActor(spec, CEO))
        .map((spec) => spec.name)
        .sort(),
    );
  });
});
