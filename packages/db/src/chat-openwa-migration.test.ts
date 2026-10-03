import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import {
  EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDatabase = support.supported ? describe : describe.skip;

const NEW_TABLES = [
  "chat_audit_entries",
  "chat_endpoint_owners",
  "chat_outbound_messages",
  "chat_owner_approval_bubbles",
  "chat_owner_approval_requests",
  "chat_owner_grants",
  "chat_scheduled_wakes",
  "chat_sender_rules",
];

describeDatabase("OpenWA chat migration", () => {
  it(
    "adds the OpenWA schema with tenant-scoped keys and enforced constraints",
    async () => {
      const database = await startEmbeddedPostgresTestDatabase("paperclip-chat-openwa-");
      const sql = postgres(database.connectionString, { max: 1, onnotice: () => {} });
      try {
        const columns = await sql`
          SELECT table_name, column_name, data_type, is_nullable, column_default
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND (table_name, column_name) IN (
              ('chat_endpoints', 'policy'), ('chat_endpoints', 'policy_revision'), ('chat_endpoints', 'inflight_mode'),
              ('chat_endpoint_resources', 'settings'), ('chat_external_principals', 'alternate_external_ids'),
              ('chat_deliveries', 'trigger_class'), ('chat_deliveries', 'principal_role'), ('chat_deliveries', 'answer_state'))
          ORDER BY table_name, column_name`;
        expect(columns.map((row) => [row.table_name, row.column_name, row.data_type, row.is_nullable, row.column_default])).toEqual([
          ["chat_deliveries", "answer_state", "text", "YES", null],
          ["chat_deliveries", "principal_role", "text", "YES", null],
          ["chat_deliveries", "trigger_class", "text", "YES", null],
          ["chat_endpoint_resources", "settings", "jsonb", "NO", "'{}'::jsonb"],
          ["chat_endpoints", "inflight_mode", "text", "NO", "'queue'::text"],
          ["chat_endpoints", "policy", "jsonb", "NO", "'{}'::jsonb"],
          ["chat_endpoints", "policy_revision", "integer", "NO", "0"],
          ["chat_external_principals", "alternate_external_ids", "ARRAY", "NO", "'{}'::text[]"],
        ]);

        const tenantKeys = await sql`
          SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
          FROM pg_constraint
          WHERE contype = 'f' AND conrelid::regclass::text = ANY(${NEW_TABLES})
            AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (company_id, endpoint_id) REFERENCES chat_endpoints(company_id, id)%'`;
        expect(tenantKeys.map((row) => row.table_name).sort()).toEqual(NEW_TABLES);
        expect(tenantKeys.every((row) => row.definition.endsWith("ON DELETE CASCADE"))).toBe(true);
        const companyKeys = await sql`
          SELECT conrelid::regclass::text AS table_name
          FROM pg_constraint
          WHERE contype = 'f' AND conrelid::regclass::text = ANY(${NEW_TABLES})
            AND pg_get_constraintdef(oid) = 'FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE'`;
        expect(companyKeys.map((row) => row.table_name).sort()).toEqual(NEW_TABLES);

        const make = async () => {
          const ids = Object.fromEntries(
            ["company", "agent", "application", "connection", "endpoint", "principal", "link"].map((key) => [key, randomUUID()]),
          );
          await sql`INSERT INTO companies (id,name,issue_prefix) VALUES (${ids.company},'OpenWA fixture',${ids.company})`;
          await sql`INSERT INTO agents (id,company_id,name) VALUES (${ids.agent},${ids.company},'Agent')`;
          await sql`INSERT INTO tool_applications (id,company_id,name,type) VALUES (${ids.application},${ids.company},'Fixture','mcp_http')`;
          await sql`INSERT INTO tool_connections (id,company_id,application_id,uid,name,transport) VALUES (${ids.connection},${ids.company},${ids.application},${randomUUID()},'Fixture','rest_api')`;
          await sql`INSERT INTO chat_endpoints (id,company_id,connection_id,provider,public_id,assigned_agent_id,status,provider_account_id,bot_external_id,inflight_mode)
            VALUES (${ids.endpoint},${ids.company},${ids.connection},'openwa',${randomUUID()},${ids.agent},'active',${`http://gw#${ids.endpoint}`},${`+62${ids.endpoint.replace(/\D/g, "").slice(0, 10)}`},'steer')`;
          await sql`INSERT INTO chat_external_principals (id,company_id,provider,provider_account_id,external_id,alternate_external_ids) VALUES (${ids.principal},${ids.company},'openwa','acct','628000@c.us',${sql.array(["1234@lid"])})`;
          await sql`INSERT INTO chat_identity_links (id,company_id,endpoint_id,principal_id,status) VALUES (${ids.link},${ids.company},${ids.endpoint},${ids.principal},'linked')`;
          return ids;
        };
        const own = await make();
        const foreign = await make();

        const [endpoint] = await sql`SELECT policy, policy_revision, inflight_mode FROM chat_endpoints WHERE id = ${own.endpoint}`;
        expect(endpoint).toEqual({ policy: {}, policy_revision: 0, inflight_mode: "steer" });
        await expect(sql`UPDATE chat_endpoints SET inflight_mode = 'drop' WHERE id = ${own.endpoint}`).rejects.toMatchObject({ code: "23514" });
        await expect(sql`UPDATE chat_endpoints SET policy_revision = -1 WHERE id = ${own.endpoint}`).rejects.toMatchObject({ code: "23514" });
        await expect(sql`UPDATE chat_endpoints SET provider = 'whatsapp' WHERE id = ${own.endpoint}`).rejects.toMatchObject({ code: "23514" });

        const [ownEndpoint] = await sql`SELECT provider_account_id, bot_external_id FROM chat_endpoints WHERE id = ${own.endpoint}`;
        await expect(
          sql`UPDATE chat_endpoints SET provider_account_id = ${ownEndpoint.provider_account_id} WHERE id = ${foreign.endpoint}`,
        ).rejects.toMatchObject({ code: "23505", constraint_name: "chat_endpoints_openwa_account_uq" });
        await expect(
          sql`UPDATE chat_endpoints SET bot_external_id = ${ownEndpoint.bot_external_id} WHERE id = ${foreign.endpoint}`,
        ).rejects.toMatchObject({ code: "23505", constraint_name: "chat_endpoints_openwa_number_uq" });
        await sql`UPDATE chat_endpoints SET status = 'archived' WHERE id = ${foreign.endpoint}`;
        await sql`UPDATE chat_endpoints SET provider_account_id = ${ownEndpoint.provider_account_id}, bot_external_id = ${ownEndpoint.bot_external_id} WHERE id = ${foreign.endpoint}`;

        await expect(
          sql`INSERT INTO chat_deliveries (company_id,endpoint_id,provider_event_id,deduplication_key,event_kind,normalized_event,trigger_class) VALUES (${own.company},${own.endpoint},'E0','E0','message','{}','vip')`,
        ).rejects.toMatchObject({ code: "23514" });
        await sql`INSERT INTO chat_deliveries (company_id,endpoint_id,provider_event_id,deduplication_key,event_kind,normalized_event,trigger_class,principal_role,answer_state)
          VALUES (${own.company},${own.endpoint},'E1','E1','message','{}','other','outside_allowlist','pending')`;

        await expect(
          sql`INSERT INTO chat_endpoint_owners (company_id,endpoint_id,identity_link_id) VALUES (${own.company},${own.endpoint},${foreign.link})`,
        ).rejects.toMatchObject({ code: "23503" });
        const [owner] = await sql`INSERT INTO chat_endpoint_owners (company_id,endpoint_id,identity_link_id) VALUES (${own.company},${own.endpoint},${own.link}) RETURNING id`;
        await expect(
          sql`INSERT INTO chat_endpoint_owners (company_id,endpoint_id,identity_link_id) VALUES (${own.company},${own.endpoint},${own.link})`,
        ).rejects.toMatchObject({ code: "23505" });

        await sql`INSERT INTO chat_sender_rules (company_id,endpoint_id,list,e164) VALUES (${own.company},${own.endpoint},'allow','+628123456789')`;
        await expect(
          sql`INSERT INTO chat_sender_rules (company_id,endpoint_id,list,e164) VALUES (${own.company},${own.endpoint},'allow','+628123456789')`,
        ).rejects.toMatchObject({ code: "23505" });
        await expect(
          sql`INSERT INTO chat_sender_rules (company_id,endpoint_id,list,e164) VALUES (${own.company},${own.endpoint},'deny','08123456789')`,
        ).rejects.toMatchObject({ code: "23514" });

        const fireAt = new Date(Date.now() + 120_000);
        await sql`INSERT INTO chat_scheduled_wakes (company_id,endpoint_id,chat_key,kind,fire_at) VALUES (${own.company},${own.endpoint},'g1','owner_absent',${fireAt})`;
        await expect(
          sql`INSERT INTO chat_scheduled_wakes (company_id,endpoint_id,chat_key,kind,fire_at) VALUES (${own.company},${own.endpoint},'g1','owner_absent',${fireAt})`,
        ).rejects.toMatchObject({ code: "23505", constraint_name: "chat_scheduled_wakes_pending_absent_uq" });
        await sql`UPDATE chat_scheduled_wakes SET state = 'fired' WHERE endpoint_id = ${own.endpoint}`;
        await sql`INSERT INTO chat_scheduled_wakes (company_id,endpoint_id,chat_key,kind,fire_at) VALUES (${own.company},${own.endpoint},'g1','owner_absent',${fireAt})`;

        await expect(
          sql`INSERT INTO chat_owner_approval_requests (company_id,endpoint_id,origin_chat_key,categories,scope,summary,proposed_action) VALUES (${own.company},${own.endpoint},'g1',${sql.array([])}::text[],'one_action','s','p')`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          sql`INSERT INTO chat_owner_approval_requests (company_id,endpoint_id,origin_chat_key,categories,scope,summary,proposed_action) VALUES (${own.company},${own.endpoint},'g1',${sql.array(["root_shell"])}::text[],'one_action','s','p')`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          sql`INSERT INTO chat_owner_approval_requests (company_id,endpoint_id,origin_chat_key,requested_by_principal_id,categories,scope,summary,proposed_action) VALUES (${own.company},${own.endpoint},'g1',${foreign.principal},${sql.array(["create_task"])}::text[],'one_action','s','p')`,
        ).rejects.toMatchObject({ code: "23503" });
        const [request] = await sql`INSERT INTO chat_owner_approval_requests (company_id,endpoint_id,origin_chat_key,requested_by_principal_id,categories,scope,summary,proposed_action)
          VALUES (${own.company},${own.endpoint},'g1',${own.principal},${sql.array(["create_task", "reply_outside_allowlist"])}::text[],'requester','s','p') RETURNING id, status, reminder_count`;
        expect(request).toMatchObject({ status: "pending", reminder_count: 0 });

        const [outbound] = await sql`INSERT INTO chat_outbound_messages (company_id,endpoint_id,chat_key,source,provider_message_id,state,body_hash,client_nonce)
          VALUES (${own.company},${own.endpoint},'owner-dm','approval','wamid-1','sent','h','n1') RETURNING id`;
        await expect(
          sql`INSERT INTO chat_outbound_messages (company_id,endpoint_id,chat_key,source,provider_message_id,body_hash,client_nonce) VALUES (${own.company},${own.endpoint},'g1','tool','wamid-1','h','n2')`,
        ).rejects.toMatchObject({ code: "23505", constraint_name: "chat_outbound_messages_provider_message_uq" });
        await sql`INSERT INTO chat_outbound_messages (company_id,endpoint_id,chat_key,source,body_hash,client_nonce) VALUES (${own.company},${own.endpoint},'g1','tool','h','n3'), (${own.company},${own.endpoint},'g1','tool','h','n4')`;
        await expect(
          sql`INSERT INTO chat_outbound_messages (company_id,endpoint_id,chat_key,source,state,body_hash,client_nonce) VALUES (${own.company},${own.endpoint},'g1','tool','delivered','h','n5')`,
        ).rejects.toMatchObject({ code: "23514" });

        await sql`INSERT INTO chat_owner_approval_bubbles (company_id,endpoint_id,request_id,owner_id,outbound_message_id) VALUES (${own.company},${own.endpoint},${request.id},${owner.id},${outbound.id})`;
        await expect(
          sql`INSERT INTO chat_owner_approval_bubbles (company_id,endpoint_id,request_id,owner_id,outbound_message_id) VALUES (${own.company},${own.endpoint},${request.id},${owner.id},${outbound.id})`,
        ).rejects.toMatchObject({ code: "23505" });

        const expiresAt = new Date(Date.now() + 86_400_000);
        await sql`INSERT INTO chat_owner_grants (company_id,endpoint_id,request_id,origin_chat_key,requester_principal_id,category,scope,approved_via,expires_at)
          VALUES (${own.company},${own.endpoint},${request.id},'g1',${own.principal},'create_task','requester','whatsapp',${expiresAt})`;
        await expect(
          sql`INSERT INTO chat_owner_grants (company_id,endpoint_id,request_id,origin_chat_key,category,scope,approved_via,expires_at) VALUES (${own.company},${own.endpoint},${request.id},'g1','create_task','forever','whatsapp',${expiresAt})`,
        ).rejects.toMatchObject({ code: "23514" });
        await expect(
          sql`INSERT INTO chat_owner_grants (company_id,endpoint_id,request_id,origin_chat_key,category,scope,approved_via,expires_at) VALUES (${foreign.company},${foreign.endpoint},${request.id},'g1','create_task','one_action','paperclip',${expiresAt})`,
        ).rejects.toMatchObject({ code: "23503" });

        await sql`INSERT INTO chat_audit_entries (company_id,endpoint_id,chat_key,kind,actor_kind,content,content_purge_at) VALUES (${own.company},${own.endpoint},'g1','trigger_admitted','chat_principal','{"text":"hi"}',now() + interval '90 days')`;
        await expect(
          sql`INSERT INTO chat_audit_entries (company_id,endpoint_id,kind,actor_kind) VALUES (${own.company},${own.endpoint},'anything','system')`,
        ).rejects.toMatchObject({ code: "23514" });

        await sql`DELETE FROM chat_identity_links WHERE id = ${own.link}`;
        expect(await sql`SELECT id FROM chat_endpoint_owners WHERE endpoint_id = ${own.endpoint}`).toHaveLength(0);
        expect(await sql`SELECT id FROM chat_owner_approval_bubbles WHERE endpoint_id = ${own.endpoint}`).toHaveLength(0);

        await sql`DELETE FROM chat_endpoints WHERE id = ${own.endpoint}`;
        for (const table of NEW_TABLES) {
          expect(await sql.unsafe(`SELECT id FROM "${table}" WHERE company_id = $1`, [own.company]), table).toHaveLength(0);
        }
      } finally {
        await sql.end();
        await database.cleanup();
      }
    },
    EMBEDDED_POSTGRES_TEST_TIMEOUT_MS,
  );
});
