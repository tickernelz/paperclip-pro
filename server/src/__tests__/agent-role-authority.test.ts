import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_AUTHORITY_CAPABILITIES,
  AGENT_WORK_AUTHORITY_CAPABILITIES,
  agentAuthorityCapabilities,
  agentAuthorityReason,
} from "@tickernelz/paperclip-pro-shared";
import {
  assertBoardOrAgentAuthority,
  assertBoardOrgOrAgentAuthority,
  hasAgentAuthority,
} from "../routes/authz.js";
import { assertNoAgentAuthorityEscalation } from "../services/agent-authority-escalation.js";
import { agentAuthorityAudit } from "../middleware/agent-authority-audit.js";
import type { Db } from "@tickernelz/paperclip-pro-db";
import type { HttpError } from "../errors.js";
import { errorHandler } from "../middleware/index.js";

type LoggedActivity = { companyId: string; actorType: string; actorId: string; action: string; details?: Record<string, unknown> };
const loggedActivities: LoggedActivity[] = [];

vi.mock("../services/activity-log.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/activity-log.js")>();
  return {
    ...actual,
    logActivity: vi.fn(async (_db: unknown, input: LoggedActivity) => {
      loggedActivities.push(input);
      return input;
    }),
  };
});


const COMPANY = "11111111-1111-4111-8111-111111111111";
const OTHER_COMPANY = "22222222-2222-4222-8222-222222222222";
const CEO_AGENT = "33333333-3333-4333-8333-333333333333";
const ENGINEER_AGENT = "44444444-4444-4444-8444-444444444444";

function agentActor(input: {
  agentId: string;
  role: string;
  companyId?: string;
  permissions?: Record<string, unknown>;
}): Express.Request["actor"] {
  return {
    type: "agent",
    agentId: input.agentId,
    agentRole: input.role,
    agentPermissions: input.permissions ?? { canCreateAgents: true, canCreateSkills: true },
    companyId: input.companyId ?? COMPANY,
    runId: null as unknown as undefined,
    source: "agent_key",
  } as Express.Request["actor"];
}

const boardActor: Express.Request["actor"] = {
  type: "board",
  userId: "operator-user",
  source: "session",
  isInstanceAdmin: false,
  companyIds: [COMPANY],
  memberships: [{ companyId: COMPANY, membershipRole: "admin", status: "active" }],
};

function fakeRequest(actor: Express.Request["actor"], method = "POST") {
  return { actor: { ...actor }, method } as unknown as express.Request;
}

function capture(run: () => void) {
  try {
    run();
    return null;
  } catch (err) {
    return err as HttpError;
  }
}

describe("agent authority capability model", () => {
  it("gives every non-ceo role exactly the work capabilities", () => {
    for (const role of ["engineer", "pm", "qa", "general", "", null]) {
      expect(agentAuthorityCapabilities(role)).toEqual(AGENT_WORK_AUTHORITY_CAPABILITIES);
      expect(agentAuthorityReason(role)).toBe("agent_work_authority");
    }
  });

  it("gives the ceo role full company authority", () => {
    expect(agentAuthorityCapabilities("ceo")).toEqual(AGENT_AUTHORITY_CAPABILITIES);
    expect(agentAuthorityCapabilities(" CEO ")).toEqual(AGENT_AUTHORITY_CAPABILITIES);
    expect(agentAuthorityReason("ceo")).toBe("agent_role_ceo");
  });
});

describe("assertBoardOrAgentAuthority", () => {
  it("allows a ceo agent to exercise company:agents in its own company", () => {
    const req = fakeRequest(agentActor({ agentId: CEO_AGENT, role: "ceo" }));
    expect(capture(() => assertBoardOrAgentAuthority(req, "company:agents", COMPANY))).toBeNull();
    expect(req.agentAuthority).toMatchObject({
      capability: "company:agents",
      reason: "agent_role_ceo",
      companyId: COMPANY,
      agentId: CEO_AGENT,
    });
  });

  it("denies an engineer agent company:agents but allows work capabilities", () => {
    const req = fakeRequest(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" }));
    const denied = capture(() => assertBoardOrAgentAuthority(req, "company:agents", COMPANY));
    expect(denied?.status).toBe(403);
    expect((denied?.details as { code?: string })?.code).toBe("AGENT_AUTHORITY_DENIED");
    expect(req.agentAuthority).toBeUndefined();

    const allowed = fakeRequest(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" }));
    expect(capture(() => assertBoardOrAgentAuthority(allowed, "work:issues", COMPANY))).toBeNull();
    expect(allowed.agentAuthority).toMatchObject({ reason: "agent_work_authority" });
  });

  it("denies a ceo agent reaching another company", () => {
    const req = fakeRequest(agentActor({ agentId: CEO_AGENT, role: "ceo" }));
    const denied = capture(() => assertBoardOrAgentAuthority(req, "company:agents", OTHER_COMPANY));
    expect(denied?.status).toBe(403);
    expect(denied?.message).toMatch(/another company/i);
  });

  it("keeps the board branch unchanged and rejects unauthenticated callers", () => {
    const board = fakeRequest(boardActor);
    expect(capture(() => assertBoardOrAgentAuthority(board, "company:agents", COMPANY))).toBeNull();
    expect(board.agentAuthority).toBeUndefined();

    const none = fakeRequest({ type: "none", source: "none" } as Express.Request["actor"]);
    expect(capture(() => assertBoardOrAgentAuthority(none, "work:read"))).toMatchObject({
      status: 401,
    });
  });

  it("requires board org access on the org variant while agents use capabilities", () => {
    const orgless: Express.Request["actor"] = {
      type: "board",
      userId: "no-company-user",
      source: "session",
      isInstanceAdmin: false,
      companyIds: [],
      memberships: [],
    };
    expect(
      capture(() => assertBoardOrgOrAgentAuthority(fakeRequest(orgless, "GET"), "work:read")),
    ).toMatchObject({ status: 403 });
    expect(
      capture(() =>
        assertBoardOrgOrAgentAuthority(
          fakeRequest(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" }), "GET"),
          "work:read",
        ),
      ),
    ).toBeNull();
  });

  it("reports capability membership without throwing", () => {
    expect(hasAgentAuthority(fakeRequest(agentActor({ agentId: CEO_AGENT, role: "ceo" })), "company:approvals")).toBe(true);
    expect(
      hasAgentAuthority(fakeRequest(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" })), "company:approvals"),
    ).toBe(false);
    expect(hasAgentAuthority(fakeRequest(boardActor), "work:read")).toBe(false);
  });
});

describe("agent authority escalation guard", () => {
  const engineer = () => fakeRequest(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" }));
  const ceo = () => fakeRequest(agentActor({ agentId: CEO_AGENT, role: "ceo" }));

  it("denies an engineer hiring a ceo agent", () => {
    const err = capture(() =>
      assertNoAgentAuthorityEscalation({ req: engineer(), write: { role: "ceo" }, target: null }),
    );
    expect(err?.status).toBe(403);
    expect((err?.details as { code?: string })?.code).toBe("AGENT_ROLE_ESCALATION_DENIED");
  });

  it("denies an engineer patching another agent to ceo and demoting a ceo", () => {
    const promote = capture(() =>
      assertNoAgentAuthorityEscalation({
        req: engineer(),
        write: { role: "ceo" },
        target: { id: CEO_AGENT, role: "pm" },
      }),
    );
    const demote = capture(() =>
      assertNoAgentAuthorityEscalation({
        req: engineer(),
        write: { role: "engineer" },
        target: { id: CEO_AGENT, role: "ceo" },
      }),
    );
    expect(promote?.status).toBe(403);
    expect(demote?.status).toBe(403);
  });

  it("denies self-edit of role, permissions, or reporting chain for every agent role", () => {
    for (const [req, id] of [
      [engineer(), ENGINEER_AGENT],
      [ceo(), CEO_AGENT],
    ] as const) {
      for (const write of [{ role: "ceo" }, { permissions: { canCreateAgents: true } }, { reportsTo: null }]) {
        const err = capture(() =>
          assertNoAgentAuthorityEscalation({ req, write, target: { id, role: "engineer" } }),
        );
        expect(err?.status).toBe(403);
        expect((err?.details as { code?: string })?.code).toBe("AGENT_SELF_ESCALATION_DENIED");
      }
    }
  });

  it("denies an engineer granting a permission it does not hold", () => {
    const req = fakeRequest(
      agentActor({
        agentId: ENGINEER_AGENT,
        role: "engineer",
        permissions: { canCreateAgents: false, canCreateSkills: false },
      }),
    );
    const err = capture(() =>
      assertNoAgentAuthorityEscalation({
        req,
        write: { permissions: { canCreateAgents: true } },
        target: null,
      }),
    );
    expect(err?.status).toBe(403);
    expect((err?.details as { code?: string })?.code).toBe("AGENT_PERMISSION_ESCALATION_DENIED");
  });

  it("denies an engineer reparenting another agent", () => {
    const err = capture(() =>
      assertNoAgentAuthorityEscalation({
        req: engineer(),
        write: { reportsTo: CEO_AGENT },
        target: { id: CEO_AGENT, role: "pm" },
      }),
    );
    expect((err?.details as { code?: string })?.code).toBe("AGENT_REPORTING_ESCALATION_DENIED");
  });

  it("allows a ceo agent to hire a ceo and to configure another agent", () => {
    expect(
      capture(() =>
        assertNoAgentAuthorityEscalation({ req: ceo(), write: { role: "ceo" }, target: null }),
      ),
    ).toBeNull();
    expect(
      capture(() =>
        assertNoAgentAuthorityEscalation({
          req: ceo(),
          write: { role: "engineer", permissions: { canCreateAgents: true }, reportsTo: CEO_AGENT },
          target: { id: ENGINEER_AGENT, role: "pm" },
        }),
      ),
    ).toBeNull();
  });

  it("ignores writes that do not touch authority fields and board actors", () => {
    expect(
      capture(() =>
        assertNoAgentAuthorityEscalation({ req: engineer(), write: { name: "Ada" }, target: null }),
      ),
    ).toBeNull();
    expect(
      capture(() =>
        assertNoAgentAuthorityEscalation({
          req: fakeRequest(boardActor),
          write: { role: "ceo" },
          target: { id: ENGINEER_AGENT, role: "engineer" },
        }),
      ),
    ).toBeNull();
  });
});

const auditDb = {} as unknown as Db;

describe("agent authority audit middleware", () => {
  beforeEach(() => {
    loggedActivities.length = 0;
  });

  function auditApp(actor: Express.Request["actor"], capability: "company:agents" | "work:read") {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { ...actor } as Express.Request["actor"];
      next();
    });
    app.use(agentAuthorityAudit(auditDb));
    app.post("/mutate", (req, res) => {
      assertBoardOrAgentAuthority(req, capability, COMPANY);
      res.json({ ok: true });
    });
    app.get("/read", (req, res) => {
      assertBoardOrAgentAuthority(req, capability, COMPANY);
      res.json({ ok: true });
    });
    app.post("/fail", (req, res) => {
      assertBoardOrAgentAuthority(req, capability, COMPANY);
      res.status(409).json({ error: "conflict" });
    });
    app.post("/service-decided", (req, res) => {
      req.actor.exercisedAgentAuthority = {
        capability: "company:agents",
        reason: "agent_role_ceo",
        companyId: COMPANY,
      };
      res.json({ ok: true });
    });
    app.post("/grant-backed", (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it("writes one agent.authority_exercised row for a successful elevated mutation", async () => {
    const app = auditApp(agentActor({ agentId: CEO_AGENT, role: "ceo" }), "company:agents");
    const res = await request(app).post("/mutate").send({});
    expect(res.status).toBe(200);
    expect(loggedActivities).toHaveLength(1);
    expect(loggedActivities[0]).toMatchObject({
      companyId: COMPANY,
      actorType: "agent",
      actorId: CEO_AGENT,
      agentId: CEO_AGENT,
      action: "agent.authority_exercised",
      details: {
        authorityReason: "agent_role_ceo",
        capability: "company:agents",
        agentRole: "ceo",
        method: "POST",
        path: "/mutate",
      },
    });
  });

  it("does not audit reads, failures, denied agents, or board callers", async () => {
    const ceo = auditApp(agentActor({ agentId: CEO_AGENT, role: "ceo" }), "company:agents");
    await request(ceo).get("/read");
    await request(ceo).post("/fail").send({});

    const engineer = auditApp(agentActor({ agentId: ENGINEER_AGENT, role: "engineer" }), "company:agents");
    const denied = await request(engineer).post("/mutate").send({});
    expect(denied.status).toBe(403);

    const board = auditApp(boardActor, "company:agents");
    const boardRes = await request(board).post("/mutate").send({});
    expect(boardRes.status).toBe(200);

    expect(loggedActivities).toHaveLength(0);
  });

  it("writes one authority row when the authorization service decided the elevation", async () => {
    const app = auditApp(agentActor({ agentId: CEO_AGENT, role: "ceo" }), "company:agents");
    const res = await request(app).post("/service-decided").send({});
    expect(res.status).toBe(200);
    expect(loggedActivities).toHaveLength(1);
    expect(loggedActivities[0]).toMatchObject({
      actorType: "agent",
      actorId: CEO_AGENT,
      action: "agent.authority_exercised",
      details: { authorityReason: "agent_role_ceo", path: "/service-decided" },
    });
  });

  it("writes no authority row for an agent write allowed by an explicit grant", async () => {
    const app = auditApp(agentActor({ agentId: CEO_AGENT, role: "ceo" }), "company:agents");
    const res = await request(app).post("/grant-backed").send({});
    expect(res.status).toBe(200);
    expect(loggedActivities).toHaveLength(0);
  });
});
