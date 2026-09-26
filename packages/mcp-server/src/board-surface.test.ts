import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AGENT_MEMBER_AUTHORITY_PERMISSION_KEYS } from "@tickernelz/paperclip-pro-shared";
import {
  ACTOR_NEUTRAL_GUARDS,
  AGENT_ADMITTING_GUARDS,
  BOARD_ONLY_GUARDS,
  boardToolAdvertised,
  classifiedGuards,
  type BoardSurfaceContext,
} from "./board-surface.js";
import { generatedToolSpecs } from "./generated-tools.js";

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
  capabilities: [
    "work:read",
    "work:issues",
    "work:routines",
    "company:issue_control",
    "company:agents",
    "company:projects",
    "company:settings",
    "company:members",
    "company:approvals",
  ],
  permissionKeys: new Set(),
};

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
      boardToolAdvertised(spec({ guards: ["assertBoard"], boardGuard: "assertBoard@chat-channels.ts:1" }), CEO),
    ).toBe(false);
  });

  it("withholds a board tool whose only extra evidence is a recorded board guard", () => {
    const probeGuarded = spec({
      guards: ["assertSameCompanyCeoAgentOrBoard"],
      boardGuard: "probe:Only board users can view feedback traces",
    });
    expect(boardToolAdvertised({ ...probeGuarded, boardGuard: null }, CEO)).toBe(true);
    expect(boardToolAdvertised(probeGuarded, CEO)).toBe(false);
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
});
