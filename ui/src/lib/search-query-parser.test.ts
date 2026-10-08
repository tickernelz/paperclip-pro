import { describe, expect, it } from "vitest";
import {
  buildSearchPathFromQuery,
  currentSearchToken,
  formatSearchToken,
  issueFilterStateToListParams,
  issueMatchesLocalSearchTerms,
  issueMatchesSearchFilters,
  localSearchTerms,
  parseSearchQuery,
  readSearchFiltersFromParams,
  searchFiltersToIssueListParams,
  splitSearchInput,
  updatedWithinToSince,
} from "./search-query-parser";

const context = {
  currentUserId: "user-1",
  agents: [
    { id: "agent-1", name: "Codex Coder", urlKey: "codex-coder" },
    { id: "agent-2", name: "QA" },
  ],
  projects: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Paperclip App", urlKey: "paperclip-app" },
  ],
  labels: [
    { id: "22222222-2222-4222-8222-222222222222", name: "bug" },
  ],
};

describe("parseSearchQuery", () => {
  it("parses status operators", () => {
    expect(parseSearchQuery("status:todo auth", context)).toMatchObject({
      query: "auth",
      filters: { status: ["todo"] },
      pills: [{ key: "status", value: "todo", label: "status:todo" }],
    });
  });

  it("parses assignee:me to the current user", () => {
    expect(parseSearchQuery("assignee:me", context).filters).toEqual({
      assigneeUserId: "user-1",
    });
  });

  it("parses assignee names including quoted multi-word names", () => {
    expect(parseSearchQuery("assignee:\"Codex Coder\" crash", context)).toMatchObject({
      query: "crash",
      filters: { assigneeAgentId: "agent-1" },
      pills: [{ key: "assignee", value: "Codex Coder", label: "assignee:Codex Coder" }],
    });
  });

  it("parses project names", () => {
    expect(parseSearchQuery("project:paperclip-app", context).filters).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("parses label names", () => {
    expect(parseSearchQuery("label:bug", context).filters).toEqual({
      labelId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("parses priority operators", () => {
    expect(parseSearchQuery("priority:high", context).filters).toEqual({
      priority: ["high"],
    });
  });

  it("parses updated:>7d as updatedWithin", () => {
    expect(parseSearchQuery("updated:>7d", context).filters).toEqual({
      updatedWithin: "7d",
    });
  });

  it("parses is:open quick filters", () => {
    expect(parseSearchQuery("is:open", context).filters).toEqual({
      status: ["backlog", "todo", "in_progress", "in_review", "blocked"],
    });
  });

  it("preserves quoted phrases in free text", () => {
    expect(parseSearchQuery("\"auth flake\" status:blocked", context)).toMatchObject({
      query: "\"auth flake\"",
      filters: { status: ["blocked"] },
    });
  });

  it("parses mixed free text and multiple operators", () => {
    expect(parseSearchQuery("auth status:in_progress priority:critical project:paperclip-app", context)).toMatchObject({
      query: "auth",
      filters: {
        status: ["in_progress"],
        priority: ["critical"],
        projectId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("falls unknown operators through to plain text", () => {
    expect(parseSearchQuery("owner:me auth", context)).toMatchObject({
      query: "owner:me auth",
      filters: {},
      pills: [],
    });
  });

  it("falls malformed values through to plain text", () => {
    expect(parseSearchQuery("status:notreal updated:>soon priority:urgent", context)).toMatchObject({
      query: "status:notreal updated:>soon priority:urgent",
      filters: {},
      pills: [],
    });
  });
});

describe("search query URLs", () => {
  it("builds /search paths with parsed filters", () => {
    expect(buildSearchPathFromQuery("auth status:todo updated:>7d", context)).toBe(
      "/search?q=auth&status=todo&updatedWithin=7d",
    );
  });

  it("reads filter params back from URLSearchParams", () => {
    const filters = readSearchFiltersFromParams(
      new URLSearchParams("q=auth&status=todo&status=blocked&priority=high&updatedWithin=7d"),
    );
    expect(filters).toEqual({
      status: ["todo", "blocked"],
      priority: ["high"],
      updatedWithin: "7d",
    });
  });
});

describe("scoped field tokens", () => {
  it("keeps field tokens inside q and reports them as pills", () => {
    expect(parseSearchQuery("title:\"internal status\" comment:deploy id:ZHA-9", context)).toMatchObject({
      query: "title:\"internal status\" comment:deploy id:ZHA-9",
      filters: {},
      pills: [
        { key: "title", value: "internal status", label: "title:internal status" },
        { key: "comment", value: "deploy", label: "comment:deploy" },
        { key: "id", value: "ZHA-9", label: "id:ZHA-9" },
      ],
    });
  });

  it("separates field tokens from filter tokens", () => {
    expect(parseSearchQuery("desc:auth text:\"rate limit\" status:done label:bug", context)).toMatchObject({
      query: "desc:auth text:\"rate limit\"",
      filters: { status: ["done"], labelId: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("parses author:me and author agent names into creator filters", () => {
    expect(parseSearchQuery("author:me", context).filters).toEqual({ createdByUserId: "user-1" });
    expect(parseSearchQuery("author:\"Codex Coder\" crash", context)).toMatchObject({
      query: "crash",
      filters: { createdByAgentId: "agent-1" },
      pills: [{ key: "author", value: "Codex Coder" }],
    });
  });

  it("parses assignee:none as unassigned", () => {
    expect(parseSearchQuery("assignee:none", context).filters).toEqual({ assigneeAgentId: null });
  });

  it("treats filter tokens outside the allowed operator set as literal text", () => {
    expect(parseSearchQuery("author:me status:todo", { ...context, operatorKeys: ["status"] })).toMatchObject({
      query: "author:me",
      filters: { status: ["todo"] },
    });
  });

  it("keeps unknown prefixes and empty field values as literal text", () => {
    expect(parseSearchQuery("foo:bar title:", context)).toMatchObject({
      query: "foo:bar title:",
      pills: [],
    });
  });
});

describe("scoped input helpers", () => {
  it("splits complete scoped tokens from free text", () => {
    expect(splitSearchInput("auth title:\"internal status\" status:todo bogus:x")).toEqual({
      tokens: ["title:\"internal status\"", "status:todo"],
      text: "auth bogus:x",
    });
  });

  it("leaves the token being typed in the text when asked", () => {
    expect(splitSearchInput("status:todo title:auth", undefined, true)).toEqual({
      tokens: ["status:todo"],
      text: "title:auth",
    });
    expect(splitSearchInput("title:\"open quote")).toEqual({ tokens: [], text: "title:\"open quote" });
  });

  it("restricts filter tokens to the allowed operator keys", () => {
    expect(splitSearchInput("author:me title:x", ["status"])).toEqual({ tokens: ["title:x"], text: "author:me" });
  });

  it("finds the current token while respecting quotes", () => {
    expect(currentSearchToken("auth title:\"a b")).toEqual({ start: 5, token: "title:\"a b" });
    expect(currentSearchToken("auth sta")).toEqual({ start: 5, token: "sta" });
  });

  it("quotes multi-word values when formatting a token", () => {
    expect(formatSearchToken("title", "internal status")).toBe("title:\"internal status\"");
    expect(formatSearchToken("label", "bug")).toBe("label:bug");
  });
});

describe("search filter params", () => {
  const now = new Date("2026-10-08T12:00:00.000Z");

  it("builds issue list params from parsed filters", () => {
    const parsed = parseSearchQuery("status:todo status:blocked priority:high assignee:none label:bug author:me updated:>7d", context);
    expect(searchFiltersToIssueListParams(parsed.filters, now)).toEqual({
      status: "todo,blocked",
      priority: "high",
      assigneeAgentId: "null",
      labelId: "22222222-2222-4222-8222-222222222222",
      createdByUserId: "user-1",
      updatedSince: "2026-10-01T12:00:00.000Z",
    });
  });

  it("converts is:open into a status CSV", () => {
    expect(searchFiltersToIssueListParams(parseSearchQuery("is:open", context).filters, now)).toEqual({
      status: "backlog,todo,in_progress,in_review,blocked",
    });
  });

  it("converts updated windows to an ISO lower bound", () => {
    expect(updatedWithinToSince("24h", now)).toBe("2026-10-07T12:00:00.000Z");
    expect(updatedWithinToSince("soon", now)).toBeNull();
  });

  it("maps the toolbar filter state to list params the server can apply", () => {
    expect(issueFilterStateToListParams({
      statuses: ["todo", "done"],
      priorities: ["high"],
      assignees: ["__me"],
      creators: ["agent:agent-1"],
      labels: ["l1", "l2"],
      projects: ["p1"],
    })).toEqual({
      status: "todo,done",
      priority: "high",
      assigneeUserId: "me",
      createdByAgentId: "agent-1",
      labelId: "l1,l2",
      projectId: "p1",
    });
    expect(issueFilterStateToListParams({
      statuses: [],
      priorities: [],
      assignees: ["__unassigned", "agent-1"],
      creators: ["user:u1", "agent:a1"],
      labels: [],
      projects: ["p1", "p2"],
    })).toEqual({});
  });
});

describe("local search matching", () => {
  const issue = { title: "Internal status page", identifier: "ZHA-9", description: "Shows the deploy state" };

  it("ANDs bare terms over title, identifier and description", () => {
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("internal deploy"))).toBe(true);
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("internal missing"))).toBe(false);
  });

  it("matches quoted phrases and scoped fields", () => {
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("\"status page\""))).toBe(true);
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("title:deploy"))).toBe(false);
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("desc:deploy"))).toBe(true);
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("id:zha-9"))).toBe(true);
    expect(issueMatchesLocalSearchTerms(issue, localSearchTerms("id:zha"))).toBe(false);
  });

  it("applies parsed filters to loaded rows", () => {
    const row = { status: "todo", priority: "high", labelIds: ["22222222-2222-4222-8222-222222222222"], updatedAt: "2026-10-06T23:00:00.000Z" };
    const now = new Date("2026-10-08T00:00:00.000Z");
    expect(issueMatchesSearchFilters(row, parseSearchQuery("status:todo label:bug updated:>7d", context).filters, now)).toBe(true);
    expect(issueMatchesSearchFilters(row, parseSearchQuery("is:closed", context).filters, now)).toBe(false);
    expect(issueMatchesSearchFilters(row, parseSearchQuery("updated:>24h", context).filters, now)).toBe(false);
  });
});
