import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CHAT_OWNER_APPROVAL_STATUSES,
  type ChatOwnerApprovalChannel,
  type ChatOwnerApprovalStatus,
  type ChatOwnerGrantScope,
  type OpenwaGrantCategory,
} from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi, type OpenwaApproval } from "@/api/chatEndpoints";
import { ApiError } from "@/api/client";
import { StatusBadge } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatDateTime } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";
import { openwaSelectClass } from "./openwa-fields";

type StatusFilter = ChatOwnerApprovalStatus | "all";
type Decision = "approve" | "reject";
type Notice = { tone: "status" | "alert"; text: string };

const categoryLabels: Record<OpenwaGrantCategory, string> = {
  create_task: "Create tasks",
  external_tools: "External tools",
  cross_chat_send: "Send to other chats",
  wa_admin: "WhatsApp admin",
  gateway_admin: "Gateway admin",
  reply_outside_allowlist: "Reply outside allowlist",
  reply: "Reply",
};

const scopeLabels: Record<ChatOwnerGrantScope, string> = {
  one_action: "One action",
  requester: "This requester until the grant expires",
};

const statusLabels: Record<ChatOwnerApprovalStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const channelLabels: Record<ChatOwnerApprovalChannel, string> = { whatsapp: "WhatsApp", paperclip: "Paperclip" };

const OWNER_ONLY_MESSAGE = "Only owners of this WhatsApp connection can approve or reject requests. Ask an owner, or add and link your number under Settings → Owners.";
const NETWORK_MESSAGE = "Couldn't reach Paperclip. Check your connection and try again.";
const REASON_MAX_LENGTH = 2000;

function alreadyResolvedMessage(error: ApiError): string {
  const body = error.body as { details?: { requestStatus?: unknown } } | null;
  const status = body?.details?.requestStatus;
  if (status === "approved") return "Another owner already approved this request. The list is refreshed.";
  if (status === "rejected") return "Another owner already rejected this request. The list is refreshed.";
  if (status === "cancelled") return "This request was cancelled before your decision. The list is refreshed.";
  return "This request was already resolved. The list is refreshed.";
}

function resolveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return OWNER_ONLY_MESSAGE;
    return error.message || "Couldn't save the decision.";
  }
  return NETWORK_MESSAGE;
}

function ApprovalRow({ endpointId, approval, onNotice }: { endpointId: string; approval: OpenwaApproval; onNotice: (notice: Notice) => void }) {
  const queryClient = useQueryClient();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const resolve = useMutation({
    mutationFn: (input: { decision: Decision; reason?: string }) => chatEndpointsApi.resolveOpenwaApproval(endpointId, approval.id, input),
    onSuccess: (result) => {
      setDecision(null);
      setNote("");
      setError(null);
      onNotice({ tone: "status", text: result.status === "approved" ? "Request approved. The agent continues with the granted permission." : "Request rejected. The agent tells the requester." });
      void queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaApprovals(endpointId) });
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.status === 409) {
        setDecision(null);
        setError(null);
        onNotice({ tone: "alert", text: alreadyResolvedMessage(failure) });
        void queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaApprovals(endpointId) });
        return;
      }
      setError(resolveErrorMessage(failure));
      if (failure instanceof ApiError && failure.status === 403) void queryClient.invalidateQueries({ queryKey: queryKeys.chatEndpoints.openwaApprovals(endpointId) });
    },
  });
  const submit = () => {
    if (!decision) return;
    const reason = note.trim();
    resolve.mutate(reason ? { decision, reason } : { decision });
  };
  const noteId = "openwa-approval-note-" + approval.id;
  return (
    <li className="space-y-3 py-4" aria-label={approval.summary}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={approval.status} label={statusLabels[approval.status]} />
        {approval.categories.map((category) => (
          <Badge key={category} variant="outline">{categoryLabels[category]}</Badge>
        ))}
        <time className="ml-auto font-mono text-xs text-muted-foreground" dateTime={approval.createdAt}>
          {formatDateTime(approval.createdAt)}
        </time>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">{approval.summary}</p>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{approval.proposedAction}</p>
      </div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Origin chat</dt>
          <dd className="truncate font-mono" title={approval.originChat}>{approval.originChat}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Scope</dt>
          <dd>{scopeLabels[approval.scope]}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Reminders sent</dt>
          <dd className="font-mono">{approval.reminderCount}</dd>
        </div>
        {approval.resolvedAt ? (
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">Resolved</dt>
            <dd>
              <time className="font-mono" dateTime={approval.resolvedAt}>{formatDateTime(approval.resolvedAt)}</time>
              {approval.resolvedVia ? " via " + channelLabels[approval.resolvedVia] : ""}
            </dd>
          </div>
        ) : null}
        {approval.ownerText ? (
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">Owner note</dt>
            <dd className="whitespace-pre-wrap break-words">{approval.ownerText}</dd>
          </div>
        ) : null}
        {approval.agentConditions ? (
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Conditions</dt>
            <dd className="whitespace-pre-wrap break-words">{approval.agentConditions}</dd>
          </div>
        ) : null}
        {approval.grants.length ? (
          <div className="min-w-0 sm:col-span-3">
            <dt className="text-xs text-muted-foreground">Grants</dt>
            <dd className="flex flex-wrap gap-2">
              {approval.grants.map((grant) => (
                <span key={grant.id} className="text-xs">
                  {categoryLabels[grant.category]} · {grant.status} · expires{" "}
                  <time className="font-mono" dateTime={grant.expiresAt}>{formatDateTime(grant.expiresAt)}</time>
                </span>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      {approval.canResolve ? (
        decision ? (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label htmlFor={noteId} className="text-xs font-medium">
              {decision === "approve" ? "Conditions for the agent (optional)" : "Reason for the agent (optional)"}
            </label>
            <Textarea
              id={noteId}
              value={note}
              maxLength={REASON_MAX_LENGTH}
              disabled={resolve.isPending}
              placeholder={decision === "approve" ? "For example: only for this order, don't mention prices" : "For example: we don't share that information"}
              onChange={(event) => setNote(event.target.value)}
            />
            <div className="flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={resolve.isPending} onClick={() => { setDecision(null); setError(null); }}>
                Cancel
              </Button>
              <Button size="sm" variant={decision === "approve" ? "default" : "destructive"} disabled={resolve.isPending} onClick={submit}>
                {resolve.isPending ? "Saving…" : decision === "approve" ? "Confirm approval" : "Confirm rejection"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => { setDecision("approve"); setError(null); }}>Approve</Button>
            <Button size="sm" variant="outline" onClick={() => { setDecision("reject"); setError(null); }}>Reject</Button>
          </div>
        )
      ) : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </li>
  );
}

export function OpenwaApprovalsList({ endpointId }: { endpointId: string }) {
  const [filter, setFilter] = useState<StatusFilter>("pending");
  const [notice, setNotice] = useState<Notice | null>(null);
  const query = useQuery({
    queryKey: [...queryKeys.chatEndpoints.openwaApprovals(endpointId), filter],
    queryFn: () => chatEndpointsApi.listOpenwaApprovals(endpointId, filter === "all" ? undefined : filter),
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });
  const rows = query.data ?? [];
  const viewOnlyPending = rows.some((row) => row.status === "pending" && !row.canResolve);
  return (
    <section className="max-w-3xl space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Approvals</h2>
          <p className="text-sm text-muted-foreground">Requests where the agent asked the owners before acting for someone else.</p>
        </div>
        <div className="grid gap-1">
          <label htmlFor="openwa-approvals-status" className="text-xs font-medium">Status</label>
          <select
            id="openwa-approvals-status"
            className={openwaSelectClass}
            value={filter}
            onChange={(event) => { setFilter(event.target.value as StatusFilter); setNotice(null); }}
          >
            {CHAT_OWNER_APPROVAL_STATUSES.map((value) => (
              <option key={value} value={value}>{statusLabels[value]}</option>
            ))}
            <option value="all">All</option>
          </select>
        </div>
      </div>
      {notice ? (
        <p role={notice.tone} className={notice.tone === "alert" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{notice.text}</p>
      ) : null}
      {viewOnlyPending ? (
        <p role="note" className="rounded-lg border border-border bg-muted/30 p-3 text-sm">{OWNER_ONLY_MESSAGE}</p>
      ) : null}
      {query.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">Loading approval requests…</p>
      ) : query.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {query.error instanceof ApiError ? query.error.message || "Couldn't load approval requests." : NETWORK_MESSAGE}
          </p>
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Try again</Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          {filter === "pending"
            ? "No requests are waiting. When the agent asks the owners for permission, the request appears here."
            : filter === "all"
              ? "No approval requests yet."
              : "No " + statusLabels[filter].toLowerCase() + " requests."}
        </p>
      ) : (
        <ul className="divide-y divide-border border-y border-border">
          {rows.map((approval) => (
            <ApprovalRow key={approval.id} endpointId={endpointId} approval={approval} onNotice={setNotice} />
          ))}
        </ul>
      )}
    </section>
  );
}
