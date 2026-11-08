import { and, asc, eq, ne, sql } from "drizzle-orm";
import { agents, companies, type Db } from "@tickernelz/wardmote-db";
import {
  OMP_ADAPTER_ALIASES,
  OMP_ADAPTER_SETTINGS,
  OMP_CONTROL_PATHS,
  OMP_FALLBACK_MODE_KEY,
  OMP_SETTINGS_PATH_PREFIX,
  OMP_STYLE_KEY,
  OMP_STYLE_PRESETS,
  OMP_THINKING_LEVELS,
  applyAgentSettingsPatch,
  readAgentSetting,
  validateAgentFallbackModels,
  validateOmpSettingsMap,
  type AgentSettingsValues,
  type OmpSettingsCatalogEntry,
} from "@tickernelz/wardmote-shared";

export const OMP_DEFAULTS_ADAPTER_TYPE = "omp_local";

const ELSEWHERE_PATHS = new Set(["env", "instructionsFilePath", "systemPrompt"]);
const BOOLEAN_PATHS = new Set(["advisor", "prewalk", "noLsp", "noSkills", "printThoughts", "experimentalContextManagement"]);
const STRING_PATHS = new Set(["model", "smolModel", "slowModel", "planModel", "tools", "skills", "profile"]);
const PATH_LIST_PATHS = new Set(["extensions", "hooks"]);

export const AGENT_DEFAULTS_ADAPTER_PATHS: ReadonlySet<string> = new Set(
  [
    ...Object.values(OMP_CONTROL_PATHS).flat(),
    ...OMP_ADAPTER_SETTINGS.map((setting) => setting.key),
    ...Object.values(OMP_ADAPTER_ALIASES).map((alias) => alias.path),
  ].filter((path) => !path.startsWith(OMP_SETTINGS_PATH_PREFIX) && !ELSEWHERE_PATHS.has(path)),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function adapterValueError(path: string, value: unknown, values: AgentSettingsValues): string | null {
  if (BOOLEAN_PATHS.has(path)) return typeof value === "boolean" ? null : `${path} must be true or false.`;
  if (STRING_PATHS.has(path)) return typeof value === "string" ? null : `${path} must be text.`;
  if (PATH_LIST_PATHS.has(path)) return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? null : `${path} must be a list of paths.`;
  switch (path) {
    case "thinking":
      return typeof value === "string" && (OMP_THINKING_LEVELS as readonly string[]).includes(value) ? null : `thinking must be one of: ${OMP_THINKING_LEVELS.join(", ")}.`;
    case OMP_STYLE_KEY:
      return typeof value === "string" && value in OMP_STYLE_PRESETS ? null : `${OMP_STYLE_KEY} must be one of: ${Object.keys(OMP_STYLE_PRESETS).join(", ")}.`;
    case OMP_FALLBACK_MODE_KEY:
      return value === "automatic" || value === "custom" ? null : `${OMP_FALLBACK_MODE_KEY} must be automatic or custom.`;
    case "approvalMode":
      return value === "yolo" || value === "write" || value === "always-ask" ? null : "approvalMode must be yolo, write or always-ask.";
    case "fallbackModels": {
      const result = validateAgentFallbackModels(value, typeof values.model === "string" ? values.model : null);
      return result.ok ? null : result.message;
    }
    case "modelEfforts":
      return isRecord(value) && Object.values(value).every((level) => typeof level === "string") ? null : "modelEfforts must map models to thinking levels.";
    case "maxTime":
      return typeof value === "string" && /^\d+$/.test(value) ? null : "maxTime must be a number of seconds.";
    case "timeoutSec":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 ? null : "timeoutSec must be a whole number of seconds, 0 for no limit.";
    default:
      return `${path} is not an agent default.`;
  }
}

export function validateAgentDefaults(values: unknown, catalog?: readonly OmpSettingsCatalogEntry[]): string[] {
  if (!isRecord(values)) return ["Defaults must be a map of setting paths to values."];
  const errors: string[] = [];
  const ompSettings: Record<string, unknown> = Object.create(null);
  for (const [path, value] of Object.entries(values)) {
    if (path.startsWith(OMP_SETTINGS_PATH_PREFIX)) {
      ompSettings[path.slice(OMP_SETTINGS_PATH_PREFIX.length)] = value;
      continue;
    }
    if (!AGENT_DEFAULTS_ADAPTER_PATHS.has(path)) {
      errors.push(`${path} is not an agent default.`);
      continue;
    }
    const problem = adapterValueError(path, value, values);
    if (problem) errors.push(problem);
  }
  return [...errors, ...validateOmpSettingsMap(ompSettings, catalog)];
}

export function withAgentDefaults(
  adapterType: string | null | undefined,
  adapterConfig: Record<string, unknown>,
  defaults: AgentSettingsValues,
): Record<string, unknown> {
  if (adapterType !== OMP_DEFAULTS_ADAPTER_TYPE) return adapterConfig;
  const missing = Object.fromEntries(Object.entries(defaults).filter(([path]) => readAgentSetting(adapterConfig, path) === undefined));
  return Object.keys(missing).length > 0 ? applyAgentSettingsPatch(adapterConfig, missing) : adapterConfig;
}

export interface PresetUsageRow {
  preset: string;
  runs: number;
  costCents: number;
  avgDurationSec: number | null;
}

export function agentDefaultsService(db: Db) {
  async function getDefaults(companyId: string): Promise<AgentSettingsValues> {
    const row = await db.select({ agentDefaults: companies.agentDefaults }).from(companies).where(eq(companies.id, companyId)).then((rows) => rows[0]);
    return isRecord(row?.agentDefaults) ? row.agentDefaults : {};
  }

  async function setDefaults(companyId: string, values: AgentSettingsValues): Promise<void> {
    await db.update(companies).set({ agentDefaults: values, updatedAt: new Date() }).where(eq(companies.id, companyId));
  }

  async function listOmpAgents(companyId: string) {
    return db
      .select({ id: agents.id, name: agents.name, adapterConfig: agents.adapterConfig })
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, OMP_DEFAULTS_ADAPTER_TYPE), ne(agents.status, "terminated")))
      .orderBy(asc(agents.name), asc(agents.id))
      .then((rows) => rows.map((row) => ({ ...row, adapterConfig: isRecord(row.adapterConfig) ? row.adapterConfig : {} })));
  }

  async function presetUsage(companyId: string, days = 7): Promise<PresetUsageRow[]> {
    const rows = await db.execute(sql`
      with runs as (
        select r.id, r.started_at, r.finished_at,
          coalesce(
            (select rev.after_config from agent_config_revisions rev
              where rev.agent_id = r.agent_id and rev.created_at <= r.started_at
              order by rev.created_at desc limit 1),
            (select rev.before_config from agent_config_revisions rev
              where rev.agent_id = r.agent_id and rev.created_at > r.started_at
              order by rev.created_at asc limit 1),
            jsonb_build_object('adapterConfig', a.adapter_config)
          ) -> 'adapterConfig' ->> ${OMP_STYLE_KEY} as preset
        from heartbeat_runs r
        join agents a on a.id = r.agent_id
        where r.company_id = ${companyId}
          and a.adapter_type = ${OMP_DEFAULTS_ADAPTER_TYPE}
          and r.started_at >= now() - make_interval(days => ${days})
      ),
      costs as (
        select ce.heartbeat_run_id, sum(ce.cost_cents) as cost_cents
        from cost_events ce
        where ce.company_id = ${companyId}
          and ce.heartbeat_run_id in (select id from runs where preset is not null)
        group by ce.heartbeat_run_id
      )
      select runs.preset,
        count(*)::int as runs,
        coalesce(sum(costs.cost_cents), 0)::float8 as cost_cents,
        avg(extract(epoch from (runs.finished_at - runs.started_at))) filter (where runs.finished_at is not null)::float8 as avg_duration_sec
      from runs
      left join costs on costs.heartbeat_run_id = runs.id
      where runs.preset is not null
      group by runs.preset
      order by runs.preset
    `);
    const list = Array.isArray(rows) ? rows as Array<Record<string, unknown>> : [];
    return list.map((row) => ({
      preset: String(row.preset),
      runs: Number(row.runs ?? 0),
      costCents: Number(row.cost_cents ?? 0),
      avgDurationSec: row.avg_duration_sec === null || row.avg_duration_sec === undefined ? null : Number(row.avg_duration_sec),
    }));
  }

  return { getDefaults, setDefaults, listOmpAgents, presetUsage };
}
