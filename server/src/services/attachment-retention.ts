import { and, eq, isNull, sql } from "drizzle-orm";
import { assets, companies, instanceSettings, type Db } from "@tickernelz/paperclip-pro-db";
import type {
  AttachmentRetentionReport,
  AttachmentRetentionRule,
  AttachmentRetentionRuleSummary,
  AttachmentRetentionSettings,
  AttachmentRetentionStatus,
} from "@tickernelz/paperclip-pro-shared";
import type { StorageService } from "../storage/types.js";
import { conflict } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { logActivity } from "./activity-log.js";
import { instanceSettingsService } from "./instance-settings.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const CANDIDATE_LIMIT = 5000;
const SAMPLE_LIMIT = 5;
const UUID_PATTERN = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const SINGLETON_KEY = "default";
const RULES: AttachmentRetentionRule[] = ["orphan_objects", "orphan_assets", "closed_tasks"];

/** Minimum gap between two scheduled retention runs. */
export const ATTACHMENT_RETENTION_INTERVAL_MS = DAY_MS;
/** How often the scheduler checks whether a retention run is due. */
export const ATTACHMENT_RETENTION_TICK_MS = 60 * 60 * 1000;
/** Activity-log action written once per affected company per retention run. */
export const ATTACHMENT_RETENTION_ACTIVITY_ACTION = "attachment.retention_purged";

const GLOBAL_TEXT_SOURCES = [
  "SELECT description AS body FROM goals",
  "SELECT concat_ws(' ', description, icon) AS body FROM projects",
  "SELECT description AS body FROM companies",
  "SELECT payload::text AS body FROM approvals",
  "SELECT body FROM approval_comments",
  'SELECT image AS body FROM "user"',
  "SELECT concat_ws(' ', icon, metadata::text, adapter_config::text, runtime_config::text) AS body FROM agents",
  "SELECT after_config::text AS body FROM agent_config_revisions",
  "SELECT payload::text AS body FROM chat_actions",
  "SELECT payload::text AS body FROM chat_scheduled_wakes",
  "SELECT concat_ws(' ', external_id, url, summary, metadata::text) AS body FROM issue_work_products",
  "SELECT concat_ws(' ', summary, fields::text) AS body FROM cases",
  "SELECT payload::text AS body FROM case_events",
  "SELECT concat_ws(' ', summary, fields::text) AS body FROM pipeline_cases",
  "SELECT description AS body FROM routines",
  "SELECT description AS body FROM routine_revisions",
  "SELECT concat_ws(' ', markdown, icon_url) AS body FROM company_skills",
  "SELECT body FROM decisions",
  "SELECT d.latest_body AS body FROM documents d WHERE NOT EXISTS (SELECT 1 FROM issue_documents x WHERE x.document_id = d.id)",
  "SELECT r.body FROM document_revisions r WHERE NOT EXISTS (SELECT 1 FROM issue_documents x WHERE x.document_id = r.document_id)",
];

function issueTextSources(issueFilter: string) {
  return [
    `SELECT concat_ws(' ', i.description, i.monitor_notes) AS body FROM issues i WHERE ${issueFilter}`,
    `SELECT c.body FROM issue_comments c JOIN issues i ON i.id = c.issue_id WHERE ${issueFilter}`,
    `SELECT d.latest_body AS body FROM documents d JOIN issue_documents x ON x.document_id = d.id JOIN issues i ON i.id = x.issue_id WHERE ${issueFilter}`,
    `SELECT r.body FROM document_revisions r JOIN issue_documents x ON x.document_id = r.document_id JOIN issues i ON i.id = x.issue_id WHERE ${issueFilter}`,
    `SELECT concat_ws(' ', t.summary, t.payload::text, t.result::text) AS body FROM issue_thread_interactions t JOIN issues i ON i.id = t.issue_id WHERE ${issueFilter}`,
    `SELECT p.payload::text AS body FROM chat_publications p JOIN issues i ON i.id = p.issue_id WHERE ${issueFilter}`,
    `SELECT e.body FROM issue_execution_decisions e JOIN issues i ON i.id = e.issue_id WHERE ${issueFilter}`,
    `SELECT a.body FROM document_annotation_comments a JOIN issues i ON i.id = a.issue_id WHERE ${issueFilter}`,
    `SELECT w.instructions AS body FROM issue_watchdogs w JOIN issues i ON i.id = w.issue_id WHERE ${issueFilter}`,
  ];
}

function closedIssuePredicate(cutoff: Date) {
  const at = `'${cutoff.toISOString()}'::timestamptz`;
  return `COALESCE((i.status = 'done' AND i.completed_at < ${at}) OR (i.status = 'cancelled' AND i.cancelled_at < ${at}), false)`;
}

const UNREFERENCED_BY_FOREIGN_KEYS = `NOT EXISTS (SELECT 1 FROM issue_attachments x WHERE x.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM case_attachments x WHERE x.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM company_logos x WHERE x.asset_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM runner_api_response_reservations x WHERE x.asset_id = a.id)`;

type RetentionCandidate = {
  rule: AttachmentRetentionRule;
  sampleId: string;
  companyId: string;
  objectKey: string;
  byteSize: number;
  assetId: string | null;
};

type RetentionActor = { actorType: "user" | "system" | "agent"; actorId: string };

type RetentionRow = Record<string, unknown>;

export interface AttachmentRetentionServiceOptions {
  storage: StorageService;
  now?: () => Date;
}

let activeRun: Promise<AttachmentRetentionReport> | null = null;

function rowsOf(result: unknown): RetentionRow[] {
  return Array.isArray(result) ? (result as RetentionRow[]) : [];
}

function textArray(values: string[]) {
  return sql`ARRAY[${sql.join(values.map((value) => sql`${value}`), sql`, `)}]::text[]`;
}

function summarize(rule: AttachmentRetentionRule, items: RetentionCandidate[]): AttachmentRetentionRuleSummary {
  return {
    rule,
    count: items.length,
    bytes: items.reduce((sum, item) => sum + item.byteSize, 0),
    sampleIds: items.slice(0, SAMPLE_LIMIT).map((item) => item.sampleId),
  };
}

/** Selects and purges unreferenced or expired attachment files, leaving tombstoned asset rows. */
export function attachmentRetentionService(db: Db, options: AttachmentRetentionServiceOptions) {
  const storage = options.storage;
  const now = options.now ?? (() => new Date());
  const settingsSvc = instanceSettingsService(db);

  async function savedSettings(): Promise<AttachmentRetentionSettings> {
    return (await settingsSvc.getGeneral()).attachmentRetention;
  }

  async function readLastRun(): Promise<AttachmentRetentionReport | null> {
    const row = await db
      .select({ lastRun: instanceSettings.attachmentRetentionLastRun })
      .from(instanceSettings)
      .where(eq(instanceSettings.singletonKey, SINGLETON_KEY))
      .then((rows) => rows[0] ?? null);
    return (row?.lastRun as unknown as AttachmentRetentionReport | null | undefined) ?? null;
  }

  async function writeLastRun(report: AttachmentRetentionReport) {
    await settingsSvc.get();
    await db
      .update(instanceSettings)
      .set({ attachmentRetentionLastRun: report as unknown as Record<string, unknown> })
      .where(eq(instanceSettings.singletonKey, SINGLETON_KEY));
  }

  async function referencedIds(sources: string[], ids: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    let remaining = [...new Set(ids.map((id) => id.toLowerCase()))];
    for (const source of sources) {
      if (remaining.length === 0) break;
      const rows = rowsOf(await db.execute(sql`
        SELECT DISTINCT c.id
        FROM unnest(${textArray(remaining)}) AS c(id)
        JOIN (
          SELECT lower(m[1]) AS ref
          FROM (${sql.raw(source)}) AS s, regexp_matches(s.body, ${UUID_PATTERN}, 'g') AS m
          WHERE s.body IS NOT NULL
        ) AS r ON r.ref = c.id
      `));
      for (const row of rows) found.add(String(row.id));
      remaining = remaining.filter((id) => !found.has(id));
    }
    return found;
  }

  async function orphanObjectCandidates(cutoff: Date): Promise<RetentionCandidate[]> {
    if (!storage.listObjects) return [];
    const candidates: RetentionCandidate[] = [];
    const companyRows = await db.select({ id: companies.id }).from(companies);
    for (const company of companyRows) {
      const known = new Set(
        (await db.select({ objectKey: assets.objectKey }).from(assets).where(eq(assets.companyId, company.id)))
          .map((row) => row.objectKey),
      );
      for await (const entry of storage.listObjects(company.id)) {
        if (candidates.length >= CANDIDATE_LIMIT) return candidates;
        if (entry.lastModified.getTime() >= cutoff.getTime() || known.has(entry.objectKey)) continue;
        candidates.push({
          rule: "orphan_objects",
          sampleId: entry.objectKey,
          companyId: company.id,
          objectKey: entry.objectKey,
          byteSize: entry.byteSize,
          assetId: null,
        });
      }
    }
    return candidates;
  }

  async function orphanAssetCandidates(cutoff: Date): Promise<RetentionCandidate[]> {
    const rows = rowsOf(await db.execute(sql`
      SELECT a.id, a.company_id, a.object_key, a.byte_size
      FROM assets a
      WHERE a.purged_at IS NULL
        AND a.created_at < ${cutoff.toISOString()}::timestamptz
        AND a.object_key NOT LIKE a.company_id::text || '/assets/agents/%'
        AND ${sql.raw(UNREFERENCED_BY_FOREIGN_KEYS)}
      ORDER BY a.created_at, a.id
      LIMIT ${CANDIDATE_LIMIT}
    `));
    const referenced = await referencedIds(
      [...GLOBAL_TEXT_SOURCES, ...issueTextSources("TRUE")],
      rows.map((row) => String(row.id)),
    );
    return rows
      .filter((row) => !referenced.has(String(row.id)))
      .map((row) => ({
        rule: "orphan_assets" as const,
        sampleId: String(row.id),
        companyId: String(row.company_id),
        objectKey: String(row.object_key),
        byteSize: Number(row.byte_size),
        assetId: String(row.id),
      }));
  }

  async function closedTaskCandidates(cutoff: Date): Promise<{ candidates: RetentionCandidate[]; missingClosedAt: number }> {
    const closed = closedIssuePredicate(cutoff);
    const rows = rowsOf(await db.execute(sql`
      SELECT ia.id AS attachment_id, a.id AS asset_id, a.company_id, a.object_key, a.byte_size
      FROM issue_attachments ia
      JOIN assets a ON a.id = ia.asset_id
      JOIN issues i ON i.id = ia.issue_id
      WHERE a.purged_at IS NULL
        AND ${sql.raw(closed)}
        AND NOT EXISTS (
          SELECT 1 FROM issue_work_products wp
          WHERE wp.provider = 'paperclip'
            AND (wp.external_id = ia.id::text OR wp.metadata->>'attachmentId' = ia.id::text OR wp.metadata->>'assetId' = a.id::text)
        )
      ORDER BY i.completed_at NULLS LAST, i.cancelled_at NULLS LAST, ia.id
      LIMIT ${CANDIDATE_LIMIT}
    `));
    const [missing] = rowsOf(await db.execute(sql`
      SELECT count(*)::int AS count
      FROM issue_attachments ia
      JOIN assets a ON a.id = ia.asset_id
      JOIN issues i ON i.id = ia.issue_id
      WHERE a.purged_at IS NULL
        AND ((i.status = 'done' AND i.completed_at IS NULL) OR (i.status = 'cancelled' AND i.cancelled_at IS NULL))
    `));
    const referenced = await referencedIds(
      [...GLOBAL_TEXT_SOURCES, ...issueTextSources(`NOT ${closed}`)],
      rows.flatMap((row) => [String(row.attachment_id), String(row.asset_id)]),
    );
    const candidates = rows
      .filter((row) => !referenced.has(String(row.attachment_id)) && !referenced.has(String(row.asset_id)))
      .map((row) => ({
        rule: "closed_tasks" as const,
        sampleId: String(row.attachment_id),
        companyId: String(row.company_id),
        objectKey: String(row.object_key),
        byteSize: Number(row.byte_size),
        assetId: String(row.asset_id),
      }));
    return { candidates, missingClosedAt: Number(missing?.count ?? 0) };
  }

  async function select(settings: AttachmentRetentionSettings) {
    const at = now();
    const orphanCutoff = new Date(at.getTime() - settings.orphanAfterDays * DAY_MS);
    const closed = settings.closedTasks.enabled
      ? await closedTaskCandidates(new Date(at.getTime() - settings.closedTasks.afterDays * DAY_MS))
      : { candidates: [], missingClosedAt: 0 };
    return {
      byRule: {
        orphan_objects: await orphanObjectCandidates(orphanCutoff),
        orphan_assets: await orphanAssetCandidates(orphanCutoff),
        closed_tasks: closed.candidates,
      } satisfies Record<AttachmentRetentionRule, RetentionCandidate[]>,
      missingClosedAt: closed.missingClosedAt,
    };
  }

  async function purge(candidate: RetentionCandidate) {
    await storage.deleteObject(candidate.companyId, candidate.objectKey);
    if (!candidate.assetId) return;
    const purgedAt = now();
    await db
      .update(assets)
      .set({ purgedAt, updatedAt: purgedAt })
      .where(and(eq(assets.id, candidate.assetId), isNull(assets.purgedAt)));
  }

  function buildReport(input: {
    mode: AttachmentRetentionReport["mode"];
    trigger: AttachmentRetentionReport["trigger"];
    startedAt: Date;
    settings: AttachmentRetentionSettings;
    byRule: Record<AttachmentRetentionRule, RetentionCandidate[]>;
    failedCount: number;
  }): AttachmentRetentionReport {
    const rules = RULES.map((rule) => summarize(rule, input.byRule[rule]));
    return {
      mode: input.mode,
      trigger: input.trigger,
      startedAt: input.startedAt.toISOString(),
      finishedAt: now().toISOString(),
      settings: input.settings,
      rules,
      totalCount: rules.reduce((sum, rule) => sum + rule.count, 0),
      totalBytes: rules.reduce((sum, rule) => sum + rule.bytes, 0),
      failedCount: input.failedCount,
    };
  }

  async function logCompanyActivity(
    trigger: AttachmentRetentionReport["trigger"],
    actor: RetentionActor,
    byRule: Record<AttachmentRetentionRule, RetentionCandidate[]>,
  ) {
    const companyIds = new Set(RULES.flatMap((rule) => byRule[rule].map((item) => item.companyId)));
    for (const companyId of companyIds) {
      const rules: Record<string, { count: number; bytes: number }> = {};
      let totalBytes = 0;
      for (const rule of RULES) {
        const items = byRule[rule].filter((item) => item.companyId === companyId);
        if (items.length === 0) continue;
        const bytes = items.reduce((sum, item) => sum + item.byteSize, 0);
        rules[rule] = { count: items.length, bytes };
        totalBytes += bytes;
      }
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        action: ATTACHMENT_RETENTION_ACTIVITY_ACTION,
        entityType: "company",
        entityId: companyId,
        details: { trigger, rules, totalBytes },
      });
    }
  }

  async function execute(
    trigger: AttachmentRetentionReport["trigger"],
    actor: RetentionActor,
  ): Promise<AttachmentRetentionReport> {
    const startedAt = now();
    const settings = await savedSettings();
    const selection = await select(settings);
    const purged = { orphan_objects: [], orphan_assets: [], closed_tasks: [] } as Record<AttachmentRetentionRule, RetentionCandidate[]>;
    let failedCount = 0;
    for (const rule of RULES) {
      for (const candidate of selection.byRule[rule]) {
        try {
          await purge(candidate);
          purged[rule].push(candidate);
        } catch (err) {
          failedCount += 1;
          logger.warn({ err, rule, objectKey: candidate.objectKey, assetId: candidate.assetId }, "attachment retention purge failed");
        }
      }
    }
    const report = buildReport({ mode: "run", trigger, startedAt, settings, byRule: purged, failedCount });
    await logCompanyActivity(trigger, actor, purged);
    await writeLastRun(report);
    logger.info(
      {
        trigger,
        totalCount: report.totalCount,
        totalBytes: report.totalBytes,
        failedCount,
        rules: Object.fromEntries(report.rules.map((rule) => [rule.rule, { count: rule.count, bytes: rule.bytes }])),
        closedTasksMissingClosedAt: selection.missingClosedAt,
      },
      "attachment retention run finished",
    );
    return report;
  }

  function exclusive(work: () => Promise<AttachmentRetentionReport>) {
    if (activeRun) throw conflict("Attachment retention is already running", { code: "attachment_retention_running" });
    const pending = work().finally(() => {
      activeRun = null;
    });
    activeRun = pending;
    return pending;
  }

  return {
    status: async (): Promise<AttachmentRetentionStatus> => ({
      settings: await savedSettings(),
      lastRun: await readLastRun(),
    }),

    preview: async (settings?: AttachmentRetentionSettings): Promise<AttachmentRetentionReport> => {
      const startedAt = now();
      const effective = settings ?? (await savedSettings());
      const selection = await select(effective);
      return buildReport({
        mode: "preview",
        trigger: "manual",
        startedAt,
        settings: effective,
        byRule: selection.byRule,
        failedCount: 0,
      });
    },

    run: (input: { trigger: AttachmentRetentionReport["trigger"]; actor?: RetentionActor }) =>
      exclusive(() => execute(input.trigger, input.actor ?? { actorType: "system", actorId: "attachment_retention" })),

    scheduledTick: async (): Promise<AttachmentRetentionReport | null> => {
      if (activeRun) return null;
      const settings = await savedSettings();
      if (!settings.enabled) return null;
      const lastRun = await readLastRun();
      if (lastRun && now().getTime() - Date.parse(lastRun.startedAt) < ATTACHMENT_RETENTION_INTERVAL_MS) return null;
      if (activeRun) return null;
      return exclusive(() => execute("scheduled", { actorType: "system", actorId: "attachment_retention" }));
    },
  };
}
