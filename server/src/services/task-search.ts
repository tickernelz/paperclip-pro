import { sql, type SQL } from "drizzle-orm";
import {
  COMPANY_SEARCH_MAX_QUERY_LENGTH,
  COMPANY_SEARCH_MAX_TOKENS,
  ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY,
} from "@tickernelz/paperclip-pro-shared";
import { visibleIssueCondition } from "./issue-visibility.js";

// Only grammatical filler is ignored, only in multi-term queries, and never
// inside quotes. Keep negation and domain words (API, UI, PR, etc.) meaningful.
const FILLER = new Set(["a", "an", "the", "and", "of", "to", "for", "in", "on", "with"]);
const TASK_SEARCH_FIELDS = ["title", "id", "desc", "comment", "doc", "text"] as const;
export type TaskSearchField = (typeof TASK_SEARCH_FIELDS)[number];
type TaskSearchSource = "title" | "identifier" | "description" | "comment" | "document";
const PRIMARY_SOURCES: readonly TaskSearchSource[] = ["title", "identifier", "description"];
const ALL_SOURCES: readonly TaskSearchSource[] = ["title", "identifier", "description", "comment", "document"];
const FIELD_SOURCES: Record<TaskSearchField, readonly TaskSearchSource[]> = {
  title: ["title"],
  id: ["identifier"],
  desc: ["description"],
  comment: ["comment"],
  doc: ["document"],
  text: ALL_SOURCES,
};
const TERM_PATTERN = new RegExp(`(?:(${TASK_SEARCH_FIELDS.join("|")}):)?(?:"([^"]+)"|([^\\s"]+))`, "g");
const DANGLING_FIELD = new Set(TASK_SEARCH_FIELDS.map((field) => `${field}:`));
const IDENTIFIER_TERM = /^[a-z][a-z0-9]*-\d+$/;

export type TaskSearchTerm = { text: string; quoted: boolean; field?: TaskSearchField };

export function escapeTaskSearchPattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function canonicalTaskIdentifier(value: string) {
  const match = /^([a-z][a-z0-9]*)[- ](\d+)$/i.exec(value) ?? /^([a-z]+)(\d+)$/i.exec(value);
  return match ? `${match[1]}-${match[2]}`.toLowerCase() : null;
}

export function parseTaskSearch(text: string) {
  const normalizedQuery = text.slice(0, COMPANY_SEARCH_MAX_QUERY_LENGTH).trim().replace(/\s+/g, " ").toLowerCase();
  const parsed = Array.from(normalizedQuery.matchAll(TERM_PATTERN), (match): TaskSearchTerm => {
    const field = match[1] as TaskSearchField | undefined;
    const value = match[2] ?? match[3]!;
    const quoted = match[2] !== undefined;
    if (!field) return { text: value, quoted };
    return { text: field === "id" ? canonicalTaskIdentifier(value) ?? value : value, quoted, field };
  }).filter((term) => term.field || term.quoted || !DANGLING_FIELD.has(term.text));
  const meaningful = parsed.filter((term) => term.field || term.quoted || !FILLER.has(term.text));
  const uniqueTerms = new Map<string, TaskSearchTerm>();
  for (const term of meaningful.length > 0 ? meaningful : parsed) {
    const key = `${term.field ?? ""}:${term.text}`;
    uniqueTerms.set(key, { ...term, quoted: term.quoted || uniqueTerms.get(key)?.quoted === true });
  }
  const terms = [...uniqueTerms.values()].slice(0, COMPANY_SEARCH_MAX_TOKENS);
  const tokens = terms.map((term) => term.text);
  const phrase = tokens.join(" ");
  const fielded = terms.some((term) => term.field !== undefined);
  // A copied/typed task identifier is navigation, never a fuzzy number match.
  const identifierQuery = fielded
    ? terms.find((term) => term.field === "id")?.text ?? normalizedQuery
    : canonicalTaskIdentifier(normalizedQuery) ?? normalizedQuery;
  const patterns = tokens.map((token) => `%${escapeTaskSearchPattern(token)}%`);
  const containsPattern = `%${escapeTaskSearchPattern(phrase)}%`;
  const startsWithPattern = `${escapeTaskSearchPattern(phrase)}%`;
  return { normalizedQuery, terms, tokens, phrase, fielded, identifierQuery, patterns, containsPattern, startsWithPattern };
}
export type TaskSearch = ReturnType<typeof parseTaskSearch>;

function taskSearchAny(field: SQL, search: TaskSearch): SQL<boolean> {
  return search.patterns.length === 0 ? sql`false`
    : sql`(${sql.join(search.patterns.map((pattern) => sql`${field} ILIKE ${pattern}`), sql` OR `)})`;
}
function termSources(term: TaskSearchTerm, includeContext: boolean): readonly TaskSearchSource[] {
  if (term.field) return FIELD_SOURCES[term.field];
  return includeContext ? ALL_SOURCES : PRIMARY_SOURCES;
}
function termAllows(term: TaskSearchTerm, source: TaskSearchSource) {
  return term.field ? FIELD_SOURCES[term.field].includes(source) : PRIMARY_SOURCES.includes(source);
}
// Short typeahead terms must start a word: UI must not match "build", and
// API must not match "Capistrano". Keep an indexable literal precondition.
export function taskSearchTermMatch(field: SQL, search: TaskSearch, index: number): SQL<boolean> {
  const term = search.tokens[index]!;
  const literal = sql<boolean>`${field} ILIKE ${search.patterns[index]!}`;
  if (IDENTIFIER_TERM.test(term)) return sql`(${literal} AND ${field} ~* ${`${term}($|[^0-9])`})`;
  return /^[\p{L}]{1,3}$/u.test(term)
    ? sql`(${literal} AND ${field} ~* ${`(^|[^[:alnum:]])${term}`})`
    : literal;
}
export function taskSearchContextMatch(field: SQL, search: TaskSearch, source: "comment" | "document"): SQL<boolean> {
  const indexes = search.terms.flatMap((term, index) => termSources(term, true).includes(source) ? [index] : []);
  return indexes.length === 0 ? sql`false`
    : sql`(${sql.join(indexes.map((index) => taskSearchTermMatch(field, search, index)), sql` OR `)})`;
}
function coverage(matches: SQL[]): SQL<number> {
  return matches.length === 0 ? sql`0`
    : sql`(${sql.join(matches.map((match) => sql`CASE WHEN ${match} THEN 1 ELSE 0 END`), sql` + `)})`;
}
function anyOf(matches: SQL[]): SQL<boolean> {
  return matches.length === 0 ? sql`false` : sql`(${sql.join(matches, sql` OR `)})`;
}

// Score bands are deliberately disjoint. Incidental comments, repeated terms,
// status and recency cannot outweigh a stronger kind of match.
export function taskSearchScore(search: TaskSearch): SQL<number> {
  const n = search.tokens.length;
  if (n === 0) return sql`0`;
  return sql`(
    CASE
      WHEN m.ident_exact THEN 8000
      WHEN m.ident_starts THEN 7000
      WHEN m.title_exact THEN 6000
      WHEN m.title_phrase AND m.title_coverage = ${n} THEN 5000
      WHEN m.title_coverage = ${n} THEN 4000
      WHEN m.issue_coverage = ${n} THEN 3000
      WHEN m.token_coverage = ${n} THEN 2000
      WHEN m.fuzzy_title THEN 1000
      ELSE 0
    END
    + m.title_word_coverage * 10
    + CASE WHEN m.title_starts THEN 30 ELSE 0 END
    + CASE m.status WHEN 'done' THEN 0 WHEN 'cancelled' THEN 0 ELSE 10 END
  )::double precision`;
}

/** Shared task retrieval for company search and issue-list/command-palette search.
 * Uses existing pg_trgm indexes and current rows: no derived corpus or worker.
 * The tagged comment/document sets are evaluated once, not once per task.
 */
export function taskSearchCtes(companyId: string, search: TaskSearch, includeContext = true, fallbackFilters?: SQL): SQL {
  const n = search.tokens.length;
  const sources = search.terms.map((term) => termSources(term, includeContext));
  const emptySet = sql`SELECT NULL::uuid AS issue_id, 0 AS ord WHERE false`;
  const commentIndexes = search.terms.flatMap((_, index) => sources[index]!.includes("comment") ? [index] : []);
  const documentIndexes = search.terms.flatMap((_, index) => sources[index]!.includes("document") ? [index] : []);
  const comments = commentIndexes.length === 0 ? emptySet
    : sql.join(commentIndexes.map((index) => sql`
      SELECT c.issue_id, ${index}::int AS ord FROM issue_comments c
      WHERE c.company_id = ${companyId} AND c.deleted_at IS NULL AND ${taskSearchTermMatch(sql`c.body`, search, index)}
      GROUP BY c.issue_id
    `), sql` UNION ALL `);
  const documents = documentIndexes.length === 0 ? emptySet
    : sql.join(documentIndexes.map((index) => sql`
      SELECT d.issue_id, ${index}::int AS ord FROM issue_documents d
      JOIN documents body ON body.id = d.document_id AND body.company_id = d.company_id
      WHERE d.company_id = ${companyId} AND d.key <> ${ISSUE_CONTINUATION_SUMMARY_DOCUMENT_KEY}
        AND (${taskSearchTermMatch(sql`body.title`, search, index)} OR ${taskSearchTermMatch(sql`body.latest_body`, search, index)})
      GROUP BY d.issue_id
    `), sql` UNION ALL `);
  const sourceMatch = (source: TaskSearchSource, index: number): SQL<boolean> => {
    if (source === "title") return taskSearchTermMatch(sql`issues.title`, search, index);
    if (source === "description") return taskSearchTermMatch(sql`issues.description`, search, index);
    if (source === "comment") return sql`issues.id IN (SELECT issue_id FROM comment_matches WHERE ord = ${index})`;
    if (source === "document") return sql`issues.id IN (SELECT issue_id FROM document_matches WHERE ord = ${index})`;
    return search.terms[index]!.field === "id"
      ? sql`lower(issues.identifier) = ${search.tokens[index]!}`
      : taskSearchTermMatch(sql`issues.identifier`, search, index);
  };
  const termMatch = (index: number, allowed: (source: TaskSearchSource) => boolean) =>
    anyOf(sources[index]!.filter(allowed).map((source) => sourceMatch(source, index)));
  const isPrimary = (source: TaskSearchSource) => PRIMARY_SOURCES.includes(source);
  const titleTerms = search.terms.map((term, index) => termAllows(term, "title") ? sourceMatch("title", index) : sql`false`);
  const issueTerms = search.terms.map((_, index) => termMatch(index, isPrimary));
  const defaultTerms = search.terms.map((term, index) => termMatch(index, (source) => termAllows(term, source)));
  const allTerms = search.terms.map((_, index) => termMatch(index, () => true));
  const fieldMatch = (source: TaskSearchSource) =>
    anyOf(search.terms.flatMap((term, index) => termAllows(term, source) ? [sourceMatch(source, index)] : []));
  const titleWide = search.terms.every((term) => termAllows(term, "title"));
  const phraseMatch = (field: SQL) => n > 0 ? sql`coalesce(${field} ILIKE ${search.containsPattern}, false)` : sql`false`;
  const identExact = n > 0 ? sql`lower(issues.identifier) = ${search.identifierQuery}` : sql`false`;
  const exactIdentifierQuery = !search.fielded && IDENTIFIER_TERM.test(search.identifierQuery);
  const identifierMention = `(^|[^[:alnum:]])${search.identifierQuery}($|[^0-9])`;
  const identMention = exactIdentifierQuery
    ? sql`(issues.title ~* ${identifierMention} OR coalesce(issues.description ~* ${identifierMention}, false))` : sql`false`;
  const identStarts = n > 0 && !search.fielded
    ? sql`issues.identifier ILIKE ${escapeTaskSearchPattern(search.identifierQuery) + "%"}` : sql`false`;
  const fuzzyAllowed = !search.fielded
    && !search.terms.some((term) => term.quoted)
    && search.terms.some((term) => /^[\p{L}]{4,255}$/u.test(term.text))
    && !/^[a-z][a-z0-9]*[- ]?\d+$/i.test(search.normalizedQuery);
  const fuzzyTerms = search.terms.map((term, index) => {
    if (!/^[\p{L}]{4,255}$/u.test(term.text)) return titleTerms[index]!;
    // Bound both arguments before calling fuzzystrmatch (255-character limit).
    // Cheap length checks prune word pairs before bounded edit-distance work.
    const edits = sql`CASE WHEN least(char_length(word), ${Array.from(term.text).length}) >= 6 THEN 2
      WHEN least(char_length(word), ${Array.from(term.text).length}) >= 5 THEN 1 ELSE 0 END`;
    return sql`(${titleTerms[index]!} OR EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(issues.title), '[^[:alnum:]]+') AS word
      WHERE CASE WHEN char_length(word) BETWEEN 4 AND 255
        AND abs(char_length(word) - ${Array.from(term.text).length}) <= ${edits}
        THEN levenshtein_less_equal(${term.text}, word, ${edits}) <= ${edits}
        ELSE false END
    ))`;
  });
  const fuzzy = fuzzyAllowed ? sql`CASE WHEN ${coverage(titleTerms)} = ${n} THEN false
    ELSE (${sql.join(fuzzyTerms, sql` AND `)}) END` : sql`false`;
  const wordTerms = search.terms.flatMap((term) => {
    if (!termAllows(term, "title")) return [];
    const escaped = term.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return [sql`issues.title ~* ${`(^|[^[:alnum:]_])${escaped}($|[^[:alnum:]_])`}`];
  });
  // Carry flags, not potentially large bodies, through materialized stages.
  // The search page fetches descriptions only for its result window.
  const flags = (fuzzyMatch: SQL) => sql`
      SELECT issues.id, issues.identifier, issues.title,
        issues.status, issues.priority, issues.assignee_agent_id, issues.assignee_user_id,
        issues.project_id, issues.created_at, issues.updated_at,
        ${identExact} AS ident_exact, ${identStarts} AS ident_starts, ${identMention} AS ident_mention,
        ${search.fielded ? sql`false` : phraseMatch(sql`issues.identifier`)} AS ident_phrase,
        ${fieldMatch("identifier")} AS ident_token,
        ${n > 0 && titleWide ? sql`lower(issues.title) = ${search.phrase}` : sql`false`} AS title_exact,
        ${n > 0 && titleWide ? sql`issues.title ILIKE ${search.startsWithPattern}` : sql`false`} AS title_starts,
        ${titleWide ? phraseMatch(sql`issues.title`) : sql`false`} AS title_phrase,
        ${fieldMatch("title")} AS title_token,
        ${fieldMatch("description")} AS desc_token,
        ${coverage(titleTerms)} AS title_coverage,
        ${coverage(wordTerms)} AS title_word_coverage,
        ${coverage(issueTerms)} AS issue_coverage,
        ${coverage(defaultTerms)} AS default_coverage,
        ${coverage(allTerms)} AS token_coverage,
        ${fuzzyMatch} AS fuzzy_title,
        issues.id IN (SELECT issue_id FROM comment_matches) AS comment_match,
        issues.id IN (SELECT issue_id FROM document_matches) AS document_match
      FROM issues
  `;
  const textMatch = sql`token_coverage = ${n}${search.fielded ? sql`` : sql` OR ident_exact OR ident_starts`}`;
  const literalGate = exactIdentifierQuery
    ? sql`ident_exact OR CASE WHEN EXISTS (SELECT 1 FROM search_flags exact WHERE exact.ident_exact)
        THEN ident_mention ELSE ${textMatch} END`
    : textMatch;
  return sql`
    WITH comment_matches AS MATERIALIZED (${comments}),
    document_matches AS MATERIALIZED (${documents}),
    literal_candidates AS MATERIALIZED (
      SELECT issues.id FROM issues
      WHERE issues.company_id = ${companyId} AND ${visibleIssueCondition()}
        AND ${n === 0 ? sql`${search.normalizedQuery.length === 0}` : sql`(
          ${taskSearchAny(sql`issues.title`, search)}
          OR ${taskSearchAny(sql`issues.identifier`, search)}
          OR ${taskSearchAny(sql`issues.description`, search)}
          OR ${identStarts}
        )`}
      UNION SELECT issue_id FROM comment_matches
      UNION SELECT issue_id FROM document_matches
    ), search_flags AS MATERIALIZED (
      ${flags(sql`false`)}
      WHERE issues.company_id = ${companyId} AND ${visibleIssueCondition()}
        AND issues.id IN (SELECT id FROM literal_candidates)
    ), literal_matches AS MATERIALIZED (
      SELECT * FROM search_flags
      WHERE ${n === 0 ? sql`true` : literalGate}
    ), fuzzy_candidates AS MATERIALIZED (
      SELECT issues.id FROM issues
      WHERE NOT EXISTS (
        SELECT 1 FROM literal_matches literal
        JOIN issues ON issues.id = literal.id
        ${fallbackFilters ? sql`WHERE ${fallbackFilters}` : sql``}
      )
        AND issues.company_id = ${companyId} AND ${visibleIssueCondition()}
        AND ${fuzzy}
    ), matched AS MATERIALIZED (
      SELECT * FROM literal_matches
      UNION ALL
      ${flags(sql`true`)}
      WHERE issues.id IN (SELECT id FROM fuzzy_candidates)
    )
  `;
}
