import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Lock, RotateCcw, Search } from "lucide-react";
import {
  OMP_ADAPTER_ALIASES,
  OMP_ADAPTER_SETTINGS,
  OMP_CONTROL_IDS,
  OMP_CONTROL_PATHS,
  OMP_ESSENTIAL_SETTINGS,
  OMP_LOCKED_SETTINGS,
  applyAgentSettingsPatch,
  defaultsAsConfig,
  ompSettingPath,
  ompSettingStoredValue,
  readAgentSetting,
  sameAgentSettingValue,
  validateOmpSettingValue,
  type Agent,
  type AgentSettingsPatch,
  type OmpSettingType,
} from "@tickernelz/paperclip-pro-shared";
import { agentDefaultsApi } from "@/api/agentDefaults";
import { agentsApi } from "@/api/agents";
import { ApiError } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { SaveBar } from "@/components/omp-settings/ChoiceControls";
import {
  CONTROL_LABELS,
  changedPaths,
  omitUndefined,
  settingsValuesFromConfig,
  useAgentDefaults,
  useOmpSettingsCatalog,
} from "@/components/omp-settings/omp-settings-model";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { Link } from "@/lib/router";
import { queryKeys } from "@/lib/queryKeys";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 60;
const ESSENTIAL = new Map(OMP_ESSENTIAL_SETTINGS.map((row) => [row.key, row]));
const CONTROL_BY_PATH = new Map(OMP_CONTROL_IDS.flatMap((control) => OMP_CONTROL_PATHS[control].map((path) => [path, control] as const)));

export type AllSettingsScope = { kind: "company" } | { kind: "agent"; agent: Agent; companyId: string };

interface SettingRow {
  key: string;
  label: string;
  description: string;
  section: string;
  type: OmpSettingType;
  options?: string[];
  path: string;
  ompDefault?: unknown;
  omp: boolean;
}

function display(value: unknown): string {
  if (value === undefined) return "not set";
  if (typeof value === "string") return value || "empty";
  return JSON.stringify(value);
}

function readRow(config: Record<string, unknown>, row: SettingRow): unknown {
  const value = readAgentSetting(config, row.path);
  return row.omp && OMP_ADAPTER_ALIASES[row.key]?.invert && typeof value === "boolean" ? !value : value;
}

function storeRow(row: SettingRow, value: unknown): unknown {
  return row.omp ? ompSettingStoredValue(row.key, value) : value;
}

function ValueEditor({
  row,
  value,
  reference,
  disabled,
  onChange,
}: {
  row: SettingRow;
  value: unknown;
  reference: unknown;
  disabled: boolean;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(() => (value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value)));
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    setText(value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value));
    setProblem(null);
  }, [value]);

  const commit = (raw: string) => {
    if (raw.trim() === "") {
      setProblem(null);
      onChange(undefined);
      return;
    }
    let next: unknown = raw;
    if (row.type === "number") next = Number(raw);
    if (row.type === "array" || row.type === "record") {
      try {
        next = JSON.parse(raw);
      } catch {
        setProblem(`Enter JSON, for example ${row.type === "array" ? '["a", "b"]' : '{"key": "value"}'}.`);
        return;
      }
    }
    const error = row.omp ? validateOmpSettingValue({ key: row.key, section: row.section, type: row.type, options: row.options, description: "" }, next) : null;
    if (error) {
      setProblem(error);
      return;
    }
    setProblem(null);
    onChange(next);
  };

  if (row.type === "boolean") {
    const checked = (value ?? reference) === true;
    return <ToggleSwitch checked={checked} disabled={disabled} aria-label={row.key} onCheckedChange={(next) => onChange(next)} />;
  }
  if (row.type === "enum") {
    return (
      <NativeSelect aria-label={row.key} disabled={disabled} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value || undefined)} className="min-h-9 sm:w-56">
        <option value="">Default ({display(reference)})</option>
        {(row.options ?? []).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </NativeSelect>
    );
  }
  const shared = {
    "aria-label": row.key,
    "aria-invalid": problem ? true : undefined,
    disabled,
    value: text,
    placeholder: reference === undefined ? "Not set" : `Default: ${display(reference)}`,
  };
  return (
    <div className="w-full space-y-1 sm:w-72">
      {row.type === "array" || row.type === "record" ? (
        <Textarea {...shared} rows={2} className="font-mono text-xs" onChange={(event) => setText(event.target.value)} onBlur={() => commit(text)} />
      ) : (
        <Input {...shared} type={row.type === "number" ? "number" : "text"} className="min-h-9" onChange={(event) => setText(event.target.value)} onBlur={() => commit(text)} />
      )}
      {problem ? <p className="text-xs text-bad">{problem}</p> : null}
    </div>
  );
}

export function OmpAllSettings({ scope, onBack }: { scope: AllSettingsScope; onBack?: () => void }) {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const companyId = scope.kind === "agent" ? scope.companyId : selectedCompanyId;
  const queryClient = useQueryClient();
  const defaults = useAgentDefaults(companyId);
  const catalog = useOmpSettingsCatalog(companyId);
  const [search, setSearch] = useState("");
  const [essentialOnly, setEssentialOnly] = useState(false);
  const [changedOnly, setChangedOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [draft, setDraft] = useState<AgentSettingsPatch>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope.kind !== "company") return;
    setBreadcrumbs([
      { label: "Settings", href: "/company/settings" },
      { label: "Agent defaults", href: "/company/settings/agent-defaults" },
      { label: "All settings" },
    ]);
  }, [scope.kind, setBreadcrumbs]);

  const defaultValues = defaults.data?.values ?? {};
  const defaultsConfig = useMemo(() => defaultsAsConfig(defaultValues), [defaultValues]);
  const base = scope.kind === "agent" ? ((scope.agent.adapterConfig ?? {}) as Record<string, unknown>) : defaultsConfig;
  const effective = useMemo(() => applyAgentSettingsPatch(base, draft), [base, draft]);

  const rows = useMemo<SettingRow[]>(() => {
    const adapterRows: SettingRow[] = OMP_ADAPTER_SETTINGS.map((setting) => ({
      key: setting.key,
      label: setting.label,
      description: setting.description,
      section: "agent",
      type: setting.type,
      path: setting.key,
      omp: false,
    }));
    const ompRows: SettingRow[] = (catalog.data?.settings ?? []).map((entry) => ({
      key: entry.key,
      label: ESSENTIAL.get(entry.key)?.label ?? entry.key,
      description: entry.description,
      section: entry.section,
      type: entry.type,
      options: entry.options,
      path: ompSettingPath(entry.key),
      ompDefault: entry.value,
      omp: true,
    }));
    return [...adapterRows, ...ompRows];
  }, [catalog.data]);

  const referenceFor = (row: SettingRow): unknown => {
    if (scope.kind === "agent") {
      const value = readRow(defaultsConfig, row);
      if (value !== undefined) return value;
    }
    return row.ompDefault;
  };
  const isChanged = (row: SettingRow): boolean =>
    scope.kind === "agent"
      ? !sameAgentSettingValue(readAgentSetting(effective, row.path), readAgentSetting(defaultsConfig, row.path))
      : readAgentSetting(effective, row.path) !== undefined;

  const term = search.trim().toLowerCase();
  const filtered = rows.filter((row) => {
    if (essentialOnly && !ESSENTIAL.has(row.key)) return false;
    if (changedOnly && !isChanged(row)) return false;
    if (!term) return true;
    return [row.key, row.label, row.description].some((text) => text.toLowerCase().includes(term));
  });
  const changedCount = rows.filter(isChanged).length;
  const essentialCount = rows.filter((row) => ESSENTIAL.has(row.key)).length;
  const pending = changedPaths(base, effective);

  const save = useMutation({
    mutationFn: async () => {
      if (scope.kind === "agent") {
        await agentsApi.update(scope.agent.id, { adapterConfig: omitUndefined(effective), replaceAdapterConfig: true }, scope.companyId);
      } else {
        await agentDefaultsApi.save(companyId!, settingsValuesFromConfig(effective));
      }
    },
    onSuccess: async () => {
      setDraft({});
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.agentDefaults.values(companyId!) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId!) }),
        queryClient.invalidateQueries({ queryKey: ["agents", "detail"] }),
      ]);
    },
    onError: (err) => {
      const details = err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as { details?: unknown }).details : null;
      setError(Array.isArray(details) ? details.join(" ") : err instanceof Error ? err.message : "Settings were not saved.");
    },
  });

  if (!companyId) return null;
  const title = scope.kind === "agent" ? `All settings for ${scope.agent.name}` : "All settings";

  return (
    <div className="max-w-4xl space-y-4 pb-4">
      <div className="space-y-1">
        {onBack ? (
          <Button type="button" variant="link" size="xs" className="px-0" onClick={onBack}>
            <ArrowLeft aria-hidden="true" />
            Back to Setup
          </Button>
        ) : null}
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-ink-3">{rows.length} settings. Most people never need this page.</p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search settings</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Search settings" className="pl-8" />
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-3">{filtered.length} of {rows.length}</span>
          <Chip selected={essentialOnly} onClick={() => setEssentialOnly((on) => !on)}>Essential {essentialCount}</Chip>
          <Chip selected={changedOnly} onClick={() => setChangedOnly((on) => !on)}>Changed {changedCount}</Chip>
        </div>
      </div>

      {catalog.error ? (
        <div role="alert" className="rounded-md border border-warn px-3 py-2 text-sm text-ink-2">
          OMP settings could not be read: {catalog.error.message}. Only Paperclip's own agent settings are listed.
        </div>
      ) : null}

      <section aria-label={title} className="overflow-hidden rounded-lg border border-line bg-bg-2">
        {filtered.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-3 sm:px-5">{catalog.isLoading ? "Loading OMP settings..." : "No setting matches."}</p>
        ) : (
          filtered.slice(0, limit).map((row) => {
            const essential = ESSENTIAL.get(row.key);
            const locked = row.omp ? OMP_LOCKED_SETTINGS[row.key] : undefined;
            const elsewhere = essential?.placement === "elsewhere" ? essential.where : undefined;
            const control = CONTROL_BY_PATH.get(row.path);
            const changed = isChanged(row);
            const value = readRow(effective, row);
            return (
              <div key={`${row.omp ? "omp" : "agent"}:${row.key}`} className={cn("flex flex-col gap-2 border-t border-line px-4 py-3 first:border-t-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:px-5", changed && "bg-accent-soft")}>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="break-all font-mono text-xs font-medium">{row.key}</span>
                    {essential ? <Badge variant="outline">Essential</Badge> : null}
                    {changed ? <Badge variant="secondary">Changed</Badge> : null}
                  </div>
                  {row.description ? <p className="text-sm text-ink-3">{row.description}</p> : null}
                  {control ? <p className="text-xs text-ink-3">Also set by {CONTROL_LABELS[control].label} in Setup.</p> : null}
                  {locked ? (
                    <p className="flex items-center gap-1 text-xs text-ink-3"><Lock aria-hidden="true" className="size-3" />{locked}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {elsewhere ? (
                    <span className="text-sm text-ink-3">Set in {elsewhere}</span>
                  ) : locked ? (
                    <span className="text-sm text-ink-3">0</span>
                  ) : (
                    <ValueEditor
                      row={row}
                      value={value}
                      reference={referenceFor(row)}
                      disabled={save.isPending}
                      onChange={(next) => setDraft((current) => ({ ...current, [row.path]: next === undefined ? undefined : storeRow(row, next) }))}
                    />
                  )}
                  {changed && !elsewhere && !locked ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Reset ${row.key}`}
                      onClick={() => setDraft((current) => ({ ...current, [row.path]: scope.kind === "agent" ? readAgentSetting(defaultsConfig, row.path) : undefined }))}
                    >
                      <RotateCcw aria-hidden="true" />
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </section>
      {filtered.length > limit ? (
        <Button type="button" variant="secondary" size="sm" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
          Show {Math.min(PAGE_SIZE, filtered.length - limit)} more
        </Button>
      ) : null}
      {scope.kind === "company" ? (
        <p className="text-sm text-ink-3">
          Saving here changes the defaults every agent without its own value follows. <Link to="/company/settings/agent-defaults" className="text-accent underline underline-offset-4">Back to Agent defaults</Link>
        </p>
      ) : null}

      {pending.length > 0 ? (
        <SaveBar
          saving={save.isPending}
          error={error}
          onDiscard={() => {
            setDraft({});
            setError(null);
          }}
          onSave={() => save.mutate()}
          summary={<span><b>{pending.length} {pending.length === 1 ? "change" : "changes"}</b>{scope.kind === "company" ? " to the agent defaults" : ` for ${scope.agent.name}`}</span>}
        />
      ) : null}
    </div>
  );
}

export function OmpAllSettingsPage() {
  return <OmpAllSettings scope={{ kind: "company" }} />;
}
