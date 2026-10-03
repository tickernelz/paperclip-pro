import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CHAT_AUDIT_ACTOR_KINDS, CHAT_AUDIT_ENTRY_KINDS, type ChatAuditActorKind, type ChatAuditEntryKind } from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi, type OpenwaAuditEntry, type OpenwaAuditFilters } from "@/api/chatEndpoints";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { openwaSelectClass } from "./openwa-fields";
import { AUDIT_KIND_LABELS, auditFields, datetimeLocalToIso } from "./openwa-settings-model";

const actorLabels: Record<ChatAuditActorKind, string> = {
  user: "Paperclip user",
  agent: "Agent",
  chat_principal: "WhatsApp sender",
  system: "System",
};

const firstPageRefresh = { staleTime: 0, refetchInterval: 5_000, refetchIntervalInBackground: false } as const;

function AuditRow({ entry, contentAccess }: { entry: OpenwaAuditEntry; contentAccess: boolean }) {
  const metadata = auditFields(entry.metadata);
  const content = auditFields(entry.content);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{AUDIT_KIND_LABELS[entry.kind]}</span>
        <span className="text-xs text-muted-foreground">
          {actorLabels[entry.actorKind]}
          {entry.actorRef ? " · " : ""}
          {entry.actorRef ? <span className="font-mono">{entry.actorRef}</span> : null}
        </span>
        {entry.contentPurged ? <Badge variant="outline">Content purged</Badge> : null}
        <time className="ml-auto font-mono text-xs text-muted-foreground" dateTime={entry.occurredAt} title={entry.occurredAt}>
          {formatDateTime(entry.occurredAt, { includeSeconds: true })}
        </time>
      </div>
      {entry.chatKey ? (
        <p className="text-xs text-muted-foreground">
          Chat <span className="font-mono">{entry.chatKey}</span>
        </p>
      ) : null}
      {metadata.length ? (
        <dl className="grid gap-x-3 gap-y-1 text-xs sm:grid-cols-2">
          {metadata.map(([key, value]) => (
            <div key={key} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 truncate font-mono" title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {contentAccess && content.length ? (
        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
          {content.map(([key, value]) => (
            <div key={key} className="text-xs">
              <p className="text-muted-foreground">{key}</p>
              <p className="whitespace-pre-wrap break-words">{value}</p>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function OpenwaAuditTab({ endpointId }: { endpointId: string }) {
  const [kind, setKind] = useState<ChatAuditEntryKind | "">("");
  const [actorKind, setActorKind] = useState<ChatAuditActorKind | "">("");
  const [chatKey, setChatKey] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState<OpenwaAuditFilters>({});
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];
  const query = useQuery({
    queryKey: [...queryKeys.chatEndpoints.audit(endpointId), applied, cursor ?? null],
    queryFn: () => chatEndpointsApi.listOpenwaAudit(endpointId, applied, cursor),
    ...firstPageRefresh,
    refetchInterval: cursor ? false : firstPageRefresh.refetchInterval,
  });
  const apply = () => {
    setApplied({
      ...(kind ? { kind } : {}),
      ...(actorKind ? { actorKind } : {}),
      ...(chatKey.trim() ? { chatKey: chatKey.trim().toLowerCase() } : {}),
      ...(datetimeLocalToIso(from) ? { from: datetimeLocalToIso(from) } : {}),
      ...(datetimeLocalToIso(to) ? { to: datetimeLocalToIso(to) } : {}),
    });
    setCursors([undefined]);
  };
  const reset = () => {
    setKind("");
    setActorKind("");
    setChatKey("");
    setFrom("");
    setTo("");
    setApplied({});
    setCursors([undefined]);
  };
  const rows = query.data?.items ?? [];
  const contentAccess = query.data?.access === "content";
  return (
    <section className="space-y-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Audit</h2>
        <p className="text-sm text-muted-foreground">Triggers, messages, tool calls, approvals, and settings changes for this WhatsApp connection.</p>
      </div>
      <div aria-label="Audit filters" className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-3">
        <div className="grid gap-1">
          <label htmlFor="openwa-audit-kind" className="text-xs font-medium">Kind</label>
          <select id="openwa-audit-kind" className={openwaSelectClass} value={kind} onChange={(event) => setKind(event.target.value as ChatAuditEntryKind | "")}>
            <option value="">All kinds</option>
            {CHAT_AUDIT_ENTRY_KINDS.map((value) => (
              <option key={value} value={value}>{AUDIT_KIND_LABELS[value]}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-audit-actor" className="text-xs font-medium">Actor</label>
          <select id="openwa-audit-actor" className={openwaSelectClass} value={actorKind} onChange={(event) => setActorKind(event.target.value as ChatAuditActorKind | "")}>
            <option value="">Any actor</option>
            {CHAT_AUDIT_ACTOR_KINDS.map((value) => (
              <option key={value} value={value}>{actorLabels[value]}</option>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-audit-chat" className="text-xs font-medium">Chat</label>
          <Input id="openwa-audit-chat" className="font-mono" placeholder="6281234567890@c.us" value={chatKey} onChange={(event) => setChatKey(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-audit-from" className="text-xs font-medium">From</label>
          <Input id="openwa-audit-from" type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-audit-to" className="text-xs font-medium">To</label>
          <Input id="openwa-audit-to" type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={apply}>Apply filters</Button>
          <Button size="sm" variant="ghost" onClick={reset}>Reset</Button>
        </div>
      </div>
      {query.data && !contentAccess ? (
        <p role="note" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
          You see metadata only. Message text and tool arguments are visible to the connection's owners and company owners.
        </p>
      ) : null}
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading audit…</p>
      ) : query.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {query.error instanceof Error && query.error.message ? query.error.message : "Couldn't load the audit."}
          </p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {Object.keys(applied).length ? "No audit entries match these filters." : "No audit entries yet."}
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((entry) => (
            <AuditRow key={entry.id} entry={entry} contentAccess={contentAccess} />
          ))}
        </ul>
      )}
      {cursors.length > 1 || query.data?.nextCursor ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors((pages) => pages.slice(0, -1))}>
            Previous
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!query.data?.nextCursor || query.isFetching || query.isError}
            onClick={() => {
              const next = query.data?.nextCursor;
              if (next) setCursors((pages) => [...pages, next]);
            }}
          >
            Next
          </Button>
        </div>
      ) : null}
    </section>
  );
}
