import {
  COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  isUuidLike,
  normalizeAgentUrlKey,
  type IssuePriority,
  type IssueStatus,
} from "@tickernelz/paperclip-pro-shared";
import type { CompanySearchParams } from "@/api/search";
import type { IssueListFilters } from "@/api/issues";
import type { IssueFilterState } from "./issue-filters";

const SEARCH_FILTER_PARAM_KEYS = [
  "status",
  "priority",
  "assigneeAgentId",
  "assigneeUserId",
  "projectId",
  "labelId",
  "updatedWithin",
  "updatedAfter",
] as const;

const OPEN_STATUSES: IssueStatus[] = ["backlog", "todo", "in_progress", "in_review", "blocked"];
const CLOSED_STATUSES: IssueStatus[] = ["done", "cancelled"];

export type SearchOperatorKey = "status" | "assignee" | "project" | "label" | "priority" | "updated" | "is" | "author";

export type SearchFieldKey = "title" | "id" | "desc" | "comment" | "doc" | "text";

export const SEARCH_FIELD_KEYS: readonly SearchFieldKey[] = ["title", "id", "desc", "comment", "doc", "text"];

export interface SearchOperatorPill {
  key: SearchOperatorKey | SearchFieldKey;
  value: string;
  label: string;
}

export type ScopedSearchFieldKey = SearchFieldKey | Exclude<SearchOperatorKey, "is">;

export interface ScopedSearchFieldDefinition {
  key: ScopedSearchFieldKey;
  label: string;
  description: string;
  kind: "text" | "picker";
}

export const SCOPED_SEARCH_FIELDS: readonly ScopedSearchFieldDefinition[] = [
  { key: "title", label: "Title", description: "Match the task title", kind: "text" },
  { key: "id", label: "ID", description: "Exact task identifier", kind: "text" },
  { key: "desc", label: "Description", description: "Match the task description", kind: "text" },
  { key: "comment", label: "Comments", description: "Match task comments", kind: "text" },
  { key: "doc", label: "Documents", description: "Match task documents", kind: "text" },
  { key: "text", label: "All text", description: "Title, ID, description, comments and documents", kind: "text" },
  { key: "status", label: "Status", description: "Filter by status, open or closed", kind: "picker" },
  { key: "priority", label: "Priority", description: "Filter by priority", kind: "picker" },
  { key: "assignee", label: "Assignee", description: "Filter by assignee", kind: "picker" },
  { key: "label", label: "Label", description: "Filter by label", kind: "picker" },
  { key: "project", label: "Project", description: "Filter by project", kind: "picker" },
  { key: "author", label: "Author", description: "Filter by who created the task", kind: "picker" },
  { key: "updated", label: "Updated", description: "Filter by last update", kind: "picker" },
];

export const SEARCH_OPERATOR_QUICK_FILTERS = ["assignee:me", "is:open", "updated:>7d"] as const;

export interface SearchQueryParserContext {
  currentAgentId?: string | null;
  currentUserId?: string | null;
  agents?: readonly { id: string; name: string; urlKey?: string | null }[];
  projects?: readonly { id: string; name: string; urlKey?: string | null }[];
  labels?: readonly { id: string; name: string }[];
  operatorKeys?: readonly SearchOperatorKey[];
}

export interface ParsedSearchQuery {
  query: string;
  filters: Pick<
    CompanySearchParams,
    | "status"
    | "priority"
    | "assigneeAgentId"
    | "assigneeUserId"
    | "projectId"
    | "labelId"
    | "updatedWithin"
    | "updatedAfter"
  > & {
    createdByAgentId?: string;
    createdByUserId?: string;
  };
  pills: SearchOperatorPill[];
}

interface QueryToken {
  raw: string;
  value: string;
}

function stripValueQuotes(value: string) {
  if (value.length >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
    return value.slice(1, -1);
  }
  return value;
}

function tokenizeQuery(input: string): QueryToken[] {
  const tokens: QueryToken[] = [];
  let index = 0;
  while (index < input.length) {
    while (/\s/.test(input[index] ?? "")) index += 1;
    if (index >= input.length) break;

    const start = index;
    if (input[index] === "\"") {
      index += 1;
      while (index < input.length && input[index] !== "\"") index += 1;
      if (input[index] === "\"") index += 1;
      const raw = input.slice(start, index);
      tokens.push({ raw, value: raw });
      continue;
    }

    while (index < input.length && !/\s/.test(input[index] ?? "")) {
      if (input[index] === ":" && input[index + 1] === "\"") {
        index += 2;
        while (index < input.length && input[index] !== "\"") index += 1;
        if (input[index] === "\"") index += 1;
        break;
      }
      index += 1;
    }

    const raw = input.slice(start, index);
    tokens.push({ raw, value: raw });
  }
  return tokens;
}

export function currentSearchToken(input: string): { start: number; token: string } {
  let start = 0;
  let inQuote = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (char === "\"") inQuote = !inQuote;
    else if (!inQuote && /\s/.test(char)) start = index + 1;
  }
  return { start, token: input.slice(start) };
}

function quoteSearchValue(value: string) {
  const cleaned = value.replace(/"/g, "").trim();
  return /[\s:]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

export function formatSearchToken(key: string, value: string) {
  return `${key}:${quoteSearchValue(value)}`;
}

export const SEARCH_OPERATOR_KEYS: readonly SearchOperatorKey[] = ["status", "priority", "assignee", "label", "project", "author", "updated", "is"];

function isCompleteScopedToken(raw: string, operatorKeys: readonly string[]) {
  const match = /^([a-zA-Z]+):(.+)$/s.exec(raw);
  if (!match) return false;
  const key = match[1]!.toLowerCase();
  if (!(SEARCH_FIELD_KEYS as readonly string[]).includes(key) && !operatorKeys.includes(key)) return false;
  const value = match[2]!;
  if (value.startsWith("\"") && (value.length < 2 || !value.endsWith("\""))) return false;
  return stripValueQuotes(value).trim().length > 0;
}

export function splitSearchInput(
  input: string,
  operatorKeys: readonly SearchOperatorKey[] = SEARCH_OPERATOR_KEYS,
  keepLastToken = false,
): { tokens: string[]; text: string } {
  const all = tokenizeQuery(input);
  const tokens: string[] = [];
  const textParts: string[] = [];
  all.forEach((token, index) => {
    const isLast = index === all.length - 1;
    if (!(keepLastToken && isLast) && isCompleteScopedToken(token.raw, operatorKeys)) tokens.push(token.raw);
    else textParts.push(token.raw);
  });
  return { tokens, text: textParts.join(" ") };
}

export function searchTokenPill(token: string, context: SearchQueryParserContext = {}): SearchOperatorPill {
  const parsed = parseSearchQuery(token, context).pills[0];
  if (parsed) return parsed;
  const match = /^([a-zA-Z]+):(.*)$/s.exec(token);
  const key = (match?.[1]?.toLowerCase() ?? "text") as SearchOperatorPill["key"];
  return { key, value: stripValueQuotes(match?.[2] ?? token), label: token };
}

function normalizedLookup(value: string) {
  return normalizeAgentUrlKey(value) ?? value.trim().toLowerCase();
}

function findByNameOrId<T extends { id: string; name: string; urlKey?: string | null }>(
  entries: readonly T[] | undefined,
  value: string,
): T | null {
  const normalized = normalizedLookup(value);
  return entries?.find((entry) => {
    if (entry.id === value) return true;
    if (normalizedLookup(entry.name) === normalized) return true;
    return entry.urlKey ? normalizedLookup(entry.urlKey) === normalized : false;
  }) ?? null;
}

function addUnique<T extends string>(values: T[] | undefined, value: T): T[] {
  return values?.includes(value) ? values : [...(values ?? []), value];
}

function appendText(parts: string[], raw: string) {
  if (raw.trim().length > 0) parts.push(raw);
}

function parseStatus(value: string): IssueStatus | null {
  return (ISSUE_STATUSES as readonly string[]).includes(value) ? value as IssueStatus : null;
}

function parsePriority(value: string): IssuePriority | null {
  return (ISSUE_PRIORITIES as readonly string[]).includes(value) ? value as IssuePriority : null;
}

function parseUpdatedWithin(value: string): string | null {
  const normalized = value.startsWith(">") ? value.slice(1) : value;
  if (!/^[1-9]\d{0,2}(h|d|w|m)$/.test(normalized)) return null;
  return normalized;
}

function operatorLabel(key: SearchOperatorKey | SearchFieldKey, value: string) {
  return `${key}:${value}`;
}

export function parseSearchQuery(input: string, context: SearchQueryParserContext = {}): ParsedSearchQuery {
  const textParts: string[] = [];
  const filters: ParsedSearchQuery["filters"] = {};
  const pills: SearchOperatorPill[] = [];

  for (const token of tokenizeQuery(input)) {
    const match = /^([a-zA-Z]+):(.*)$/s.exec(token.value);
    if (!match) {
      appendText(textParts, token.raw);
      continue;
    }

    const key = match[1]!.toLowerCase();
    const rawValue = match[2]!;
    const value = stripValueQuotes(rawValue).trim();
    if (!value) {
      appendText(textParts, token.raw);
      continue;
    }

    if ((SEARCH_FIELD_KEYS as readonly string[]).includes(key)) {
      appendText(textParts, token.raw);
      pills.push({ key: key as SearchFieldKey, value, label: operatorLabel(key as SearchFieldKey, value) });
      continue;
    }

    if (context.operatorKeys && !(context.operatorKeys as readonly string[]).includes(key)) {
      appendText(textParts, token.raw);
      continue;
    }

    if (key === "status") {
      const status = parseStatus(value);
      if (!status) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.status = addUnique(filters.status, status);
      pills.push({ key: "status", value: status, label: operatorLabel("status", status) });
      continue;
    }

    if (key === "priority") {
      const priority = parsePriority(value);
      if (!priority) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.priority = addUnique(filters.priority, priority);
      pills.push({ key: "priority", value: priority, label: operatorLabel("priority", priority) });
      continue;
    }

    if (key === "assignee") {
      if (value.toLowerCase() === "me") {
        if (context.currentAgentId) {
          filters.assigneeAgentId = context.currentAgentId;
          pills.push({ key: "assignee", value: "me", label: "assignee:me" });
          continue;
        }
        if (context.currentUserId) {
          filters.assigneeUserId = context.currentUserId;
          pills.push({ key: "assignee", value: "me", label: "assignee:me" });
          continue;
        }
        appendText(textParts, token.raw);
        continue;
      }

      if (value.toLowerCase() === "none") {
        filters.assigneeAgentId = null;
        pills.push({ key: "assignee", value: "none", label: "assignee:none" });
        continue;
      }

      const agent = findByNameOrId(context.agents, value);
      if (!agent) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.assigneeAgentId = agent.id;
      pills.push({ key: "assignee", value: agent.name, label: operatorLabel("assignee", agent.name) });
      continue;
    }

    if (key === "author") {
      if (value.toLowerCase() === "me") {
        if (context.currentAgentId) {
          filters.createdByAgentId = context.currentAgentId;
          pills.push({ key: "author", value: "me", label: "author:me" });
          continue;
        }
        if (context.currentUserId) {
          filters.createdByUserId = context.currentUserId;
          pills.push({ key: "author", value: "me", label: "author:me" });
          continue;
        }
        appendText(textParts, token.raw);
        continue;
      }
      const agent = findByNameOrId(context.agents, value);
      if (!agent) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.createdByAgentId = agent.id;
      pills.push({ key: "author", value: agent.name, label: operatorLabel("author", agent.name) });
      continue;
    }

    if (key === "project") {
      const project = findByNameOrId(context.projects, value);
      if (!project) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.projectId = project.id;
      pills.push({ key: "project", value: project.name, label: operatorLabel("project", project.name) });
      continue;
    }

    if (key === "label") {
      const label = findByNameOrId(context.labels, value);
      if (label) {
        filters.labelId = label.id;
        pills.push({ key: "label", value: label.name, label: operatorLabel("label", label.name) });
        continue;
      }
      if (isUuidLike(value)) {
        filters.labelId = value;
        pills.push({ key: "label", value, label: operatorLabel("label", value.slice(0, 8)) });
        continue;
      }
      appendText(textParts, token.raw);
      continue;
    }

    if (key === "updated") {
      const updatedWithin = parseUpdatedWithin(value);
      if (!updatedWithin) {
        appendText(textParts, token.raw);
        continue;
      }
      filters.updatedWithin = updatedWithin;
      pills.push({ key: "updated", value: `>${updatedWithin}`, label: operatorLabel("updated", `>${updatedWithin}`) });
      continue;
    }

    if (key === "is") {
      if (value === "open") {
        filters.status = OPEN_STATUSES;
        pills.push({ key: "is", value: "open", label: "is:open" });
        continue;
      }
      if (value === "closed") {
        filters.status = CLOSED_STATUSES;
        pills.push({ key: "is", value: "closed", label: "is:closed" });
        continue;
      }
      appendText(textParts, token.raw);
      continue;
    }

    appendText(textParts, token.raw);
  }

  return {
    query: textParts.join(" ").replace(/\s+/g, " ").trim(),
    filters,
    pills,
  };
}

function appendMulti(search: URLSearchParams, key: string, values: readonly string[] | undefined) {
  for (const value of values ?? []) search.append(key, value);
}

export function clearSearchFilterParams(search: URLSearchParams) {
  for (const key of SEARCH_FILTER_PARAM_KEYS) search.delete(key);
}

export function applySearchFiltersToParams(search: URLSearchParams, filters: ParsedSearchQuery["filters"]) {
  clearSearchFilterParams(search);
  appendMulti(search, "status", filters.status);
  appendMulti(search, "priority", filters.priority);
  if (filters.assigneeAgentId !== undefined) search.set("assigneeAgentId", filters.assigneeAgentId ?? "null");
  if (filters.assigneeUserId !== undefined) search.set("assigneeUserId", filters.assigneeUserId);
  if (filters.projectId !== undefined) search.set("projectId", filters.projectId);
  if (filters.labelId !== undefined) search.set("labelId", filters.labelId);
  if (filters.updatedWithin !== undefined) search.set("updatedWithin", filters.updatedWithin);
  if (filters.updatedAfter !== undefined) search.set("updatedAfter", filters.updatedAfter);
}

function validValues<T extends string>(values: string[], allowed: readonly T[]): T[] {
  return values.filter((value): value is T => (allowed as readonly string[]).includes(value));
}

export function readSearchFiltersFromParams(search: URLSearchParams): ParsedSearchQuery["filters"] {
  const filters: ParsedSearchQuery["filters"] = {};
  const statuses = validValues(search.getAll("status").flatMap((value) => value.split(",")), ISSUE_STATUSES);
  const priorities = validValues(search.getAll("priority").flatMap((value) => value.split(",")), ISSUE_PRIORITIES);
  const assigneeAgentId = search.get("assigneeAgentId");
  const assigneeUserId = search.get("assigneeUserId");
  const projectId = search.get("projectId");
  const labelId = search.get("labelId");
  const updatedWithin = search.get("updatedWithin");
  const updatedAfter = search.get("updatedAfter");

  if (statuses.length > 0) filters.status = statuses;
  if (priorities.length > 0) filters.priority = priorities;
  if (assigneeAgentId !== null) filters.assigneeAgentId = assigneeAgentId === "null" ? null : assigneeAgentId;
  if (assigneeUserId) filters.assigneeUserId = assigneeUserId;
  if (projectId && isUuidLike(projectId)) filters.projectId = projectId;
  if (labelId && isUuidLike(labelId)) filters.labelId = labelId;
  if (updatedWithin && (/^[1-9]\d{0,2}(h|d|w|m)$/.test(updatedWithin) || (COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS as readonly string[]).includes(updatedWithin))) {
    filters.updatedWithin = updatedWithin;
  }
  if (updatedAfter && !Number.isNaN(new Date(updatedAfter).getTime())) filters.updatedAfter = updatedAfter;
  return filters;
}

export function hasSearchFilters(filters: ParsedSearchQuery["filters"]) {
  return Boolean(
    filters.status?.length
    || filters.priority?.length
    || filters.assigneeAgentId !== undefined
    || filters.assigneeUserId
    || filters.projectId
    || filters.labelId
    || filters.updatedWithin
    || filters.updatedAfter
    || filters.createdByAgentId
    || filters.createdByUserId,
  );
}

const UPDATED_WITHIN_UNIT_HOURS: Record<string, number> = { h: 1, d: 24, w: 24 * 7, m: 24 * 30 };

export function updatedWithinToSince(value: string, now: Date = new Date()): string | null {
  const match = /^(\d+)(h|d|w|m)$/.exec(value);
  if (!match) return null;
  const hours = Number.parseInt(match[1]!, 10) * UPDATED_WITHIN_UNIT_HOURS[match[2]!]!;
  return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
}

export type IssueListSearchParams = Pick<
  IssueListFilters,
  | "status"
  | "priority"
  | "assigneeAgentId"
  | "assigneeUserId"
  | "projectId"
  | "labelId"
  | "createdByAgentId"
  | "createdByUserId"
  | "updatedSince"
>;

export function searchFiltersToIssueListParams(
  filters: ParsedSearchQuery["filters"],
  now: Date = new Date(),
): IssueListSearchParams {
  const params: IssueListSearchParams = {};
  if (filters.status?.length) params.status = filters.status.join(",");
  if (filters.priority?.length) params.priority = filters.priority.join(",");
  if (filters.assigneeAgentId !== undefined) params.assigneeAgentId = filters.assigneeAgentId ?? "null";
  if (filters.assigneeUserId) params.assigneeUserId = filters.assigneeUserId;
  if (filters.projectId) params.projectId = filters.projectId;
  if (filters.labelId) params.labelId = filters.labelId;
  if (filters.createdByAgentId) params.createdByAgentId = filters.createdByAgentId;
  if (filters.createdByUserId) params.createdByUserId = filters.createdByUserId;
  const updatedSince = filters.updatedAfter ?? (filters.updatedWithin ? updatedWithinToSince(filters.updatedWithin, now) : null);
  if (updatedSince) params.updatedSince = updatedSince;
  return params;
}

export function issueFilterStateToListParams(
  state: Pick<IssueFilterState, "statuses" | "priorities" | "assignees" | "creators" | "labels" | "projects">,
): IssueListSearchParams {
  const params: IssueListSearchParams = {};
  if (state.statuses.length > 0) params.status = state.statuses.join(",");
  if (state.priorities.length > 0) params.priority = state.priorities.join(",");
  if (state.labels.length > 0) params.labelId = state.labels.join(",");
  if (state.projects.length === 1) params.projectId = state.projects[0];
  if (state.assignees.length === 1) {
    const assignee = state.assignees[0]!;
    if (assignee === "__me") params.assigneeUserId = "me";
    else if (assignee !== "__unassigned") params.assigneeAgentId = assignee;
  }
  if (state.creators.length === 1) {
    const creator = state.creators[0]!;
    if (creator.startsWith("agent:")) params.createdByAgentId = creator.slice("agent:".length);
    if (creator.startsWith("user:")) params.createdByUserId = creator.slice("user:".length);
  }
  return params;
}

interface LocalSearchTerm {
  field: SearchFieldKey | null;
  value: string;
}

export function localSearchTerms(query: string): LocalSearchTerm[] {
  const terms: LocalSearchTerm[] = [];
  for (const token of tokenizeQuery(query)) {
    const match = /^([a-zA-Z]+):(.+)$/s.exec(token.value);
    const key = match?.[1]?.toLowerCase();
    if (match && key && (SEARCH_FIELD_KEYS as readonly string[]).includes(key)) {
      const value = stripValueQuotes(match[2]!).trim().toLowerCase();
      if (value) terms.push({ field: key as SearchFieldKey, value });
      continue;
    }
    const value = stripValueQuotes(token.value).trim().toLowerCase();
    if (value) terms.push({ field: null, value });
  }
  return terms;
}

export function localSearchText(query: string): string {
  return localSearchTerms(query).map((term) => term.value).join(" ");
}

type LocallySearchableIssue = {
  title: string;
  identifier?: string | null;
  description?: string | null;
};

export function issueMatchesLocalSearchTerms(issue: LocallySearchableIssue, terms: readonly LocalSearchTerm[]): boolean {
  const title = issue.title.toLowerCase();
  const identifier = (issue.identifier ?? "").toLowerCase();
  const description = (issue.description ?? "").toLowerCase();
  return terms.every((term) => {
    if (term.field === "title") return title.includes(term.value);
    if (term.field === "id") return identifier === term.value;
    if (term.field === "desc") return description.includes(term.value);
    return title.includes(term.value) || identifier.includes(term.value) || description.includes(term.value);
  });
}

type LocallyFilterableIssue = {
  status: string;
  priority: string;
  assigneeAgentId?: string | null;
  assigneeUserId?: string | null;
  projectId?: string | null;
  labelIds?: string[] | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  updatedAt: Date | string;
};

export function issueMatchesSearchFilters(
  issue: LocallyFilterableIssue,
  filters: ParsedSearchQuery["filters"],
  now: Date = new Date(),
): boolean {
  if (filters.status?.length && !(filters.status as readonly string[]).includes(issue.status)) return false;
  if (filters.priority?.length && !(filters.priority as readonly string[]).includes(issue.priority)) return false;
  if (filters.assigneeAgentId !== undefined && (issue.assigneeAgentId ?? null) !== filters.assigneeAgentId) return false;
  if (filters.assigneeUserId && issue.assigneeUserId !== filters.assigneeUserId) return false;
  if (filters.projectId && issue.projectId !== filters.projectId) return false;
  if (filters.labelId && !(issue.labelIds ?? []).includes(filters.labelId)) return false;
  if (filters.createdByAgentId && issue.createdByAgentId !== filters.createdByAgentId) return false;
  if (filters.createdByUserId && issue.createdByUserId !== filters.createdByUserId) return false;
  const updatedSince = filters.updatedAfter ?? (filters.updatedWithin ? updatedWithinToSince(filters.updatedWithin, now) : null);
  if (updatedSince && new Date(issue.updatedAt).getTime() < new Date(updatedSince).getTime()) return false;
  return true;
}

function nameForId<T extends { id: string; name: string }>(entries: readonly T[] | undefined, id: string) {
  return entries?.find((entry) => entry.id === id)?.name ?? id.slice(0, 8);
}

export function searchFilterPills(
  filters: ParsedSearchQuery["filters"],
  context: SearchQueryParserContext = {},
): SearchOperatorPill[] {
  const pills: SearchOperatorPill[] = [];
  for (const status of filters.status ?? []) {
    pills.push({ key: "status", value: status, label: operatorLabel("status", status) });
  }
  for (const priority of filters.priority ?? []) {
    pills.push({ key: "priority", value: priority, label: operatorLabel("priority", priority) });
  }
  if (filters.assigneeAgentId !== undefined) {
    const value = filters.assigneeAgentId === null
      ? "unassigned"
      : nameForId(context.agents, filters.assigneeAgentId);
    pills.push({ key: "assignee", value, label: operatorLabel("assignee", value) });
  }
  if (filters.assigneeUserId) {
    const value = filters.assigneeUserId === context.currentUserId ? "me" : filters.assigneeUserId.slice(0, 8);
    pills.push({ key: "assignee", value, label: operatorLabel("assignee", value) });
  }
  if (filters.projectId) {
    const value = nameForId(context.projects, filters.projectId);
    pills.push({ key: "project", value, label: operatorLabel("project", value) });
  }
  if (filters.labelId) {
    const value = nameForId(context.labels, filters.labelId);
    pills.push({ key: "label", value, label: operatorLabel("label", value) });
  }
  if (filters.updatedWithin) {
    pills.push({ key: "updated", value: `>${filters.updatedWithin}`, label: operatorLabel("updated", `>${filters.updatedWithin}`) });
  }
  if (filters.updatedAfter) {
    pills.push({ key: "updated", value: filters.updatedAfter, label: operatorLabel("updated", filters.updatedAfter) });
  }
  return pills;
}

export function buildSearchPathFromQuery(input: string, context: SearchQueryParserContext = {}) {
  const parsed = parseSearchQuery(input, context);
  const search = new URLSearchParams();
  if (parsed.query.length > 0) search.set("q", parsed.query);
  applySearchFiltersToParams(search, parsed.filters);
  const qs = search.toString();
  return qs ? `/search?${qs}` : "/search";
}
