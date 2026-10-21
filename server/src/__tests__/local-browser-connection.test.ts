import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  companies,
  companyMemberships,
  createDb,
  toolConnections,
} from "@tickernelz/paperclip-pro-db";
import { toolAccessService } from "../services/tool-access.js";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const actor = { actorType: "user" as const, actorId: "local-browser-reviewer" };

(support.supported ? describe : describe.skip)("Local Browser connection setup", () => {
  let db: ReturnType<typeof createDb>;
  let temp: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>>;

  beforeAll(async () => {
    temp = await startEmbeddedPostgresTestDatabase("paperclip-local-browser-");
    db = createDb(temp.connectionString);
  }, 60_000);

  afterAll(async () => {
    await temp?.cleanup();
  });

  async function fixture() {
    const [company] = await db
      .insert(companies)
      .values({ name: "Local browser fixture", issuePrefix: `LB${randomUUID().slice(0, 6)}` })
      .returning();
    await db.insert(companyMemberships).values({
      companyId: company.id,
      principalType: "user",
      principalId: actor.actorId,
      membershipRole: "admin",
      status: "active",
    });
    return company;
  }

  it("connects the paired-browser connector without a credential or a discovered action", async () => {
    const company = await fixture();
    const access = toolAccessService(db);
    const connected = await access.connectGalleryApp(
      company.id,
      { galleryKey: "local-browser" },
      actor,
    );
    const [row] = await db
      .select()
      .from(toolConnections)
      .where(eq(toolConnections.id, connected.connectionId));

    expect(row.transport).toBe("rest_api");
    expect(row.authKind).toBe("none");
    expect(row.config.sourceTemplateKey).toBe("local-browser");
    expect(connected.catalog).toEqual([]);

    const finished = await access.finishGalleryAppConnection(
      company.id,
      connected.connectionId,
      { enabledCatalogEntryIds: [], askFirstCatalogEntryIds: [], access: { agentIds: [] } },
      actor,
    );
    expect(finished.connection.status).toBe("active");
    expect(finished.profileEntries).toEqual([]);
  }, 60_000);
});
