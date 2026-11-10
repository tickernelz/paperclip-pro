import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { mcpGatewayProtocolRoutes } from "../routes/tool-gateway.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  activityLog,
  companies,
  companyMemberships,
  connectionGrants,
  createDb,
  heartbeatRuns,
  toolAccessAuditEvents,
  toolApplications,
  toolConnectionInstalls,
  toolConnections,
  toolCatalogEntries,
  toolMcpGateways,
  toolMcpGatewayTokens,
  toolProfileBindings,
  toolProfileEntries,
  toolProfiles,
} from "@tickernelz/wardmote-db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { buildWardmoteRuntimeMcpServers } from "../services/heartbeat.js";
import { createToolGatewayService, ToolGatewayHttpError } from "../services/tool-gateway.js";

import { toolAccessService } from "../services/tool-access.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("heartbeat runtime MCP servers", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const originalApiUrl = process.env.WARDMOTE_API_URL;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-heartbeat-runtime-mcp-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    if (originalApiUrl === undefined) delete process.env.WARDMOTE_API_URL;
    else process.env.WARDMOTE_API_URL = originalApiUrl;
    await db.delete(toolMcpGatewayTokens);
    await db.delete(activityLog);
    await db.delete(toolAccessAuditEvents);
    await db.delete(heartbeatRuns);
    await db.delete(toolMcpGateways);
    await db.delete(connectionGrants);
    await db.delete(toolConnectionInstalls);
    await db.delete(toolProfileBindings);
    await db.delete(toolProfileEntries);
    await db.delete(toolProfiles);
    await db.delete(toolConnections);
    await db.delete(toolApplications);
    await db.delete(agents);
    await db.delete(companyMemberships);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedAssignedAgents(count: number) {
    process.env.WARDMOTE_API_URL = "https://paperclip.example.test";
    const [company] = await db.insert(companies).values({
      name: `Runtime MCP ${randomUUID()}`,
      issuePrefix: `RM${randomUUID().slice(0, 5).toUpperCase()}`,
    }).returning();
    const [application] = await db.insert(toolApplications).values({
      companyId: company!.id,
      applicationKey: `runtime-${randomUUID().slice(0, 8)}`,
      name: "Runtime MCP App",
      type: "mcp_http",
      status: "active",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId: company!.id,
      applicationId: application!.id,
      name: "Installed MCP",
      uid: `test/${randomUUID()}`,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      config: { url: "https://installed.example.test/mcp" },
    }).returning();
    const [profile] = await db.insert(toolProfiles).values({
      companyId: company!.id,
      profileKey: `app:${connection!.id}`,
      name: "Installed MCP",
      defaultAction: "deny",
    }).returning();
    await db.insert(toolProfileEntries).values({
      companyId: company!.id,
      profileId: profile!.id,
      selectorType: "connection",
      effect: "include",
      applicationId: application!.id,
      connectionId: connection!.id,
    });
    const seeded = [];
    for (let index = 0; index < count; index += 1) {
      const [agent] = await db.insert(agents).values({
        companyId: company!.id,
        name: `Runtime MCP Agent ${index}`,
        role: "engineer",
        adapterType: "codex_local",
        adapterConfig: {},
      }).returning();
      await db.insert(toolProfileBindings).values({
        companyId: company!.id,
        profileId: profile!.id,
        targetType: "agent",
        targetId: agent!.id,
      });
      await db.insert(toolConnectionInstalls).values({
        companyId: company!.id,
        connectionId: connection!.id,
        targetType: "agent",
        targetId: agent!.id,
      });
      const [run] = await db.insert(heartbeatRuns).values({
        companyId: company!.id,
        agentId: agent!.id,
        status: "running",
        contextSnapshot: {},
      }).returning();
      seeded.push({ agent: agent!, run: run! });
    }
    return seeded;
  }

  it("rejects another agent's run token on a run-scoped gateway", async () => {
    const [owner, other] = await seedAssignedAgents(2);
    const [server] = await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });
    const [gateway] = await db.select().from(toolMcpGateways);
    const service = createToolGatewayService(db);
    const otherToken = await service.createNamedGatewayToken({
      companyId: owner!.agent.companyId,
      gatewayId: gateway!.id,
      body: {
        name: "Other agent run",
        subjectType: "heartbeat_run",
        subjectId: other!.run.id,
        allowedActions: ["tools/list", "tools/call"],
        expiresAt: new Date(Date.now() + 60_000),
      },
      actor: { agentId: other!.agent.id },
    });

    await expect(
      service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: server!.token }),
    ).resolves.toMatchObject({ agentId: owner!.agent.id, runId: owner!.run.id });
    const rejection = await service
      .initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: otherToken.token })
      .catch((error: unknown) => error);
    expect(rejection).toBeInstanceOf(ToolGatewayHttpError);
    expect((rejection as ToolGatewayHttpError).reasonCode).toBe("gateway_token_run_context_invalid");
  });

  it("binds a reused run-scoped gateway that was created without an agent", async () => {
    const [owner] = await seedAssignedAgents(1);
    await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });
    // Simulate a gateway provisioned before the agentId column was set.
    await db.update(toolMcpGateways).set({ agentId: null });

    await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });

    const gateways = await db.select().from(toolMcpGateways);
    expect(gateways).toHaveLength(1);
    expect(gateways[0]!.agentId).toBe(owner!.agent.id);
  });

  it("rejects another run on a legacy native gateway before the owner runs again", async () => {
    const [owner, other] = await seedAssignedAgents(2);
    const [server] = await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });
    const [gateway] = await db.select().from(toolMcpGateways);
    await db.update(toolMcpGateways).set({ agentId: null }).where(eq(toolMcpGateways.id, gateway!.id));
    const service = createToolGatewayService(db);
    const token = await service.createNamedGatewayToken({
      companyId: owner!.agent.companyId, gatewayId: gateway!.id,
      body: { name: "Other run", subjectType: "heartbeat_run", subjectId: other!.run.id,
        allowedActions: ["tools/list"], expiresAt: new Date(Date.now() + 60_000) },
      actor: { agentId: other!.agent.id },
    });
    await expect(service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: server!.token }))
      .resolves.toMatchObject({ agentId: owner!.agent.id });
    await expect(service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: token.token }))
      .rejects.toMatchObject({ reasonCode: "gateway_token_run_context_invalid" });
    const app = express().use(express.json()).use(mcpGatewayProtocolRoutes(service));
    const initialize = (bearer: string) => request(app).post(`/mcp/gateways/${gateway!.gatewayPublicId}`)
      .set("Authorization", `Bearer ${bearer}`).send({ jsonrpc: "2.0", id: 1, method: "initialize" });
    await initialize(server!.token).expect(200);
    await initialize(token.token).expect(401);
    await db.update(toolMcpGateways).set({ metadata: { nativeRuntimeAssignmentDigest: "invalid" } })
      .where(eq(toolMcpGateways.id, gateway!.id));
    await expect(service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: server!.token }))
      .rejects.toMatchObject({ reasonCode: "gateway_token_run_context_invalid" });
    await db.update(toolMcpGateways).set({ metadata: gateway!.metadata }).where(eq(toolMcpGateways.id, gateway!.id));
    await db.update(toolProfiles).set({ metadata: {} }).where(eq(toolProfiles.id, gateway!.profileId));
    await expect(service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: server!.token }))
      .rejects.toMatchObject({ reasonCode: "gateway_token_run_context_invalid" });
  });

  it("rejects JSON null profile metadata with an HTTP authentication response", async () => {
    const [owner] = await seedAssignedAgents(1);
    const [server] = await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });
    const [gateway] = await db.select().from(toolMcpGateways);
    await db.update(toolProfiles).set({ metadata: sql`'null'::jsonb` }).where(eq(toolProfiles.id, gateway!.profileId));
    const service = createToolGatewayService(db);
    await expect(service.initializeNamedGatewayProtocol({ gatewayId: gateway!.id, bearerToken: server!.token }))
      .rejects.toMatchObject({ reasonCode: "gateway_token_run_context_invalid" });
    const app = express().use(express.json()).use(mcpGatewayProtocolRoutes(service));
    await request(app).post(`/mcp/gateways/${gateway!.gatewayPublicId}`)
      .set("Authorization", `Bearer ${server!.token}`).send({ jsonrpc: "2.0", id: 1, method: "initialize" }).expect(401);
  });

  it("does not repair a gateway with conflicting ownership metadata", async () => {
    const [owner, other] = await seedAssignedAgents(2);
    const [server] = await buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id });
    await db.update(toolMcpGateways).set({ agentId: null,
      metadata: { nativeRuntimeAssignmentDigest: server!.connectionId.slice("assignment:".length), agentId: other!.agent.id } });
    await expect(buildWardmoteRuntimeMcpServers({ db, agent: owner!.agent, runId: owner!.run.id }))
      .rejects.toThrow("Invalid native runtime gateway provenance");
    const [gateway] = await db.select().from(toolMcpGateways);
    expect(gateway!.agentId).toBeNull();
  });

  it("preserves exact permissions when an aggregate assignment exceeds the public 250-entry edit limit", async () => {
    process.env.WARDMOTE_API_URL = "https://paperclip.example.test";
    const [company] = await db.insert(companies).values({
      name: "Large MCP assignment",
      issuePrefix: `LM${randomUUID().slice(0, 5).toUpperCase()}`,
    }).returning();
    const [agent, gatewayReader] = await db.insert(agents).values([
      { companyId: company!.id, name: "Cursor Cloud", role: "engineer", adapterType: "cursor_cloud" },
      { companyId: company!.id, name: "Gateway reader", role: "engineer", adapterType: "cursor_cloud" },
    ]).returning();
    const [application] = await db.insert(toolApplications).values({
      companyId: company!.id, applicationKey: "large-mcp", name: "Large MCP", type: "mcp_http",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId: company!.id, applicationId: application!.id,
      name: "Large MCP", uid: `test/${randomUUID()}`, transport: "mcp_remote", status: "active", enabled: true,
      config: { url: "https://large.example.test/mcp" },
    }).returning();
    const catalogInput = (name: string) => ({
      companyId: company!.id, applicationId: application!.id, connectionId: connection!.id,
      name, toolName: name, versionHash: "fixture", status: "active" as const,
    });
    const catalog = await db.insert(toolCatalogEntries).values([
      ...Array.from({ length: 251 }, (_, index) => catalogInput(`allowed_${index}`)),
      catalogInput("excluded"), catalogInput("unassigned"),
    ]).returning();
    const allowed = catalog.slice(0, 251);
    const excluded = catalog[251]!;
    // Multiple valid profiles can each have fewer than 250 entries while their
    // union exceeds the HTTP edit-request limit.
    const profiles = await db.insert(toolProfiles).values(["first", "second"].map((key) => ({
      companyId: company!.id, profileKey: key, name: key, defaultAction: "deny" as const,
    }))).returning();
    await db.insert(toolProfileEntries).values([
      ...[...allowed, excluded].map((tool, index) => ({
        companyId: company!.id, profileId: profiles[index < 200 ? 0 : 1]!.id,
        selectorType: "catalog_entry" as const, effect: "include" as const,
        applicationId: application!.id, connectionId: connection!.id, catalogEntryId: tool.id,
      })),
      {
        companyId: company!.id, profileId: profiles[1]!.id,
        selectorType: "catalog_entry" as const, effect: "exclude" as const,
        applicationId: application!.id, connectionId: connection!.id, catalogEntryId: excluded.id,
      },
    ]);
    await db.insert(toolProfileBindings).values(profiles.map((profile) => ({
      companyId: company!.id, profileId: profile.id, targetType: "agent" as const, targetId: agent!.id,
    })));
    await db.insert(toolConnectionInstalls).values({
      companyId: company!.id, connectionId: connection!.id, targetType: "agent", targetId: agent!.id,
    });

    const servers = await buildWardmoteRuntimeMcpServers({ db, agent: agent!, runId: randomUUID() });
    expect(servers).toHaveLength(1);
    const [gateway] = await db.select().from(toolMcpGateways);
    const generatedEntries = await db.select().from(toolProfileEntries)
      .where(eq(toolProfileEntries.profileId, gateway!.profileId!));
    expect(generatedEntries).toHaveLength(251);
    expect(generatedEntries.every((entry) => entry.selectorType === "catalog_entry")).toBe(true);
    expect(generatedEntries.map((entry) => entry.catalogEntryId).sort()).toEqual(allowed.map((tool) => tool.id).sort());

    // Evaluate the generated profile independently of the original assignments,
    // including a tool discovered after the immutable profile was created.
    await db.insert(toolCatalogEntries).values(catalogInput("new_after_snapshot"));
    await db.insert(toolProfileBindings).values({
      companyId: company!.id, profileId: gateway!.profileId!, targetType: "agent", targetId: gatewayReader!.id,
    });
    const effective = await toolAccessService(db).getEffectiveProfilesForAgent(company!.id, gatewayReader!.id);
    expect(effective.allowedTools.map((tool) => tool.id).sort()).toEqual(allowed.map((tool) => tool.id).sort());
    expect(effective.allowedToolNames).not.toContain("excluded");
    expect(effective.allowedToolNames).not.toContain("unassigned");
    expect(effective.allowedToolNames).not.toContain("new_after_snapshot");

    const reused = await buildWardmoteRuntimeMcpServers({ db, agent: agent!, runId: randomUUID() });
    expect(reused[0]!.connectionId).toBe(servers[0]!.connectionId);
    expect(await db.select().from(toolMcpGateways)).toHaveLength(1);
  });

  it("exposes only the dedicated GitHub connection when a personal connection is also installed", async () => {
    process.env.WARDMOTE_API_URL = "https://paperclip.example.test";
    const [company] = await db.insert(companies).values({
      name: `Runtime GitHub identity ${randomUUID()}`,
      issuePrefix: `RG${randomUUID().slice(0, 5).toUpperCase()}`,
    }).returning();
    await db.insert(companyMemberships).values({
      companyId: company!.id,
      principalType: "user",
      principalId: "responsible-user",
      status: "active",
      membershipRole: "member",
    });
    const [agent] = await db.insert(agents).values({
      companyId: company!.id,
      name: "Dedicated GitHub Agent",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
    }).returning();
    const [application] = await db.insert(toolApplications).values({
      companyId: company!.id,
      applicationKey: `github-${randomUUID().slice(0, 8)}`,
      name: "GitHub",
      type: "mcp_http",
      status: "active",
      metadata: { sourceTemplateKey: "github" },
    }).returning();
    const [personal, dedicated] = await db.insert(toolConnections).values([
      {
        companyId: company!.id,
        applicationId: application!.id,
        name: "Responsible user's GitHub",
        uid: `github/${randomUUID()}`,
        transport: "mcp_remote",
        credentialPolicy: "per_user",
        status: "active",
        enabled: true,
        healthStatus: "ok",
        config: {},
        transportConfig: { sourceTemplateKey: "github" },
      },
      {
        companyId: company!.id,
        applicationId: application!.id,
        name: "Dedicated GitHub",
        uid: `github/${randomUUID()}`,
        transport: "mcp_remote",
        credentialPolicy: "per_agent",
        status: "active",
        enabled: true,
        healthStatus: "ok",
        config: {},
        transportConfig: { sourceTemplateKey: "github" },
      },
    ]).returning();
    await db.insert(connectionGrants).values([
      {
        companyId: company!.id,
        connectionId: personal!.id,
        kind: "user",
        subjectUserId: "responsible-user",
        status: "active",
        isDefault: false,
      },
      {
        companyId: company!.id,
        connectionId: dedicated!.id,
        kind: "agent",
        subjectAgentId: agent!.id,
        status: "active",
        isDefault: false,
      },
    ]);
    await db.insert(toolConnectionInstalls).values([
      {
        companyId: company!.id,
        connectionId: personal!.id,
        targetType: "company",
        targetId: company!.id,
      },
      {
        companyId: company!.id,
        connectionId: dedicated!.id,
        targetType: "agent",
        targetId: agent!.id,
      },
    ]);
    const [profile] = await db.insert(toolProfiles).values({
      companyId: company!.id,
      profileKey: `github-identities:${agent!.id}`,
      name: "GitHub identities",
      defaultAction: "deny",
    }).returning();
    await db.insert(toolProfileEntries).values([personal!, dedicated!].map((connection) => ({
      companyId: company!.id,
      profileId: profile!.id,
      selectorType: "connection" as const,
      effect: "include" as const,
      applicationId: application!.id,
      connectionId: connection.id,
    })));
    await db.insert(toolProfileBindings).values({
      companyId: company!.id,
      profileId: profile!.id,
      targetType: "agent",
      targetId: agent!.id,
    });
    const [run] = await db.insert(heartbeatRuns).values({
      companyId: company!.id,
      agentId: agent!.id,
      status: "running",
      responsibleUserId: "responsible-user",
      contextSnapshot: {},
    }).returning();

    const servers = await buildWardmoteRuntimeMcpServers({ db, agent: agent!, runId: run!.id });

    expect(servers).toHaveLength(1);
    const [runtimeGateway] = await db.select().from(toolMcpGateways);
    expect(runtimeGateway).toBeTruthy();
    const runtimeEntries = await db.select().from(toolProfileEntries)
      .where(eq(toolProfileEntries.profileId, runtimeGateway!.profileId!));
    expect(runtimeEntries.map((entry) => entry.connectionId)).toEqual([dedicated!.id]);
  });

  it("audits permitted remote MCP connections that were not installed when delivery is empty", async () => {
    const [company] = await db.insert(companies).values({
      name: `Runtime MCP diagnostic ${randomUUID()}`,
      issuePrefix: `RD${randomUUID().slice(0, 5).toUpperCase()}`,
    }).returning();
    const [agent] = await db.insert(agents).values({
      companyId: company!.id,
      name: "Runtime MCP Diagnostic Agent",
      role: "engineer",
      adapterType: "codex_local",
      adapterConfig: {},
    }).returning();
    const [application] = await db.insert(toolApplications).values({
      companyId: company!.id,
      applicationKey: `runtime-diagnostic-${randomUUID().slice(0, 8)}`,
      name: "Zapier",
      type: "mcp_http",
      status: "active",
    }).returning();
    const [connection] = await db.insert(toolConnections).values({
      companyId: company!.id,
      applicationId: application!.id,
      name: "Zapier",
      uid: `test/${randomUUID()}`,
      transport: "mcp_remote",
      status: "active",
      enabled: true,
      config: { url: "https://zapier.example.test/mcp" },
    }).returning();
    const [profile] = await db.insert(toolProfiles).values({
      companyId: company!.id,
      profileKey: `app:${connection!.id}`,
      name: "Zapier",
      defaultAction: "deny",
    }).returning();
    await db.insert(toolProfileEntries).values({
      companyId: company!.id,
      profileId: profile!.id,
      selectorType: "connection",
      effect: "include",
      applicationId: application!.id,
      connectionId: connection!.id,
    });
    await db.insert(toolProfileBindings).values({
      companyId: company!.id,
      profileId: profile!.id,
      targetType: "agent",
      targetId: agent!.id,
    });
    const runId = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: runId,
      companyId: company!.id,
      agentId: agent!.id,
      status: "running",
      contextSnapshot: {},
    });

    const servers = await buildWardmoteRuntimeMcpServers({ db, agent: agent!, runId });

    expect(servers).toEqual([]);
    const [activity] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.action, "tool_gateway.runtime_mcp_delivery"));
    expect(activity).toMatchObject({
      companyId: company!.id,
      agentId: agent!.id,
      runId,
      details: expect.objectContaining({
        reasonCode: "permitted_connections_not_installed",
        deliveredServerCount: 0,
        permittedNotInstalledCount: 1,
        permittedNotInstalledConnections: [{ id: connection!.id, name: "Zapier" }],
      }),
    });
    const [audit] = await db.select().from(toolAccessAuditEvents);
    expect(audit).toMatchObject({
      companyId: company!.id,
      actorType: "agent",
      actorId: agent!.id,
      reasonCode: "permitted_connections_not_installed",
      details: expect.objectContaining({ runId, deliveredServerCount: 0 }),
    });
  });

});
