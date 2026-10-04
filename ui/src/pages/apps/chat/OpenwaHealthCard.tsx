import { useQuery } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import type { OpenwaEndpointHealth } from "@tickernelz/paperclip-pro-shared";
import { chatEndpointsApi, type ChatEndpoint } from "@/api/chatEndpoints";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { queryKeys } from "@/lib/queryKeys";

export function openwaHealthRows(health: OpenwaEndpointHealth): Array<{ label: string; value: string; attention?: boolean }> {
  const restriction = health.session.restriction;
  return [
    {
      label: "Gateway version",
      value: health.gatewayVersion ?? "Unknown (API document unavailable)",
      attention: health.gatewayVersion !== null && health.gatewayVersion !== health.pinnedVersion,
    },
    { label: "Engine", value: health.engine ?? "Unknown" },
    {
      label: "Session",
      value: (health.session.status ?? "Unknown") + (health.session.maskedNumber ? " · " + health.session.maskedNumber : ""),
      attention: health.session.status !== null && health.session.status !== "ready",
    },
    {
      label: "Pacing",
      value: health.pacing.observedAt
        ? "Observed · last limited " + formatDateTime(health.pacing.observedAt, { includeSeconds: true })
        : health.pacing.attested
          ? "Attested · not yet observed"
          : "Not attested",
      attention: !health.pacing.attested && !health.pacing.observedAt,
    },
    {
      label: "Restriction",
      value: restriction?.active
        ? "Active" + (restriction.kind ? " (" + restriction.kind + ")" : "") + (restriction.expiresAt ? " until " + formatDateTime(restriction.expiresAt) : "")
        : "None",
      attention: restriction?.active === true,
    },
  ];
}

export function OpenwaHealthCard({ endpoint }: { endpoint: Pick<ChatEndpoint, "id" | "status" | "healthMessage" | "lastError"> }) {
  const health = useQuery({
    queryKey: queryKeys.chatEndpoints.openwaHealth(endpoint.id),
    queryFn: () => chatEndpointsApi.getOpenwaHealth(endpoint.id),
    staleTime: 30_000,
  });
  return (
    <section aria-label="Gateway health" className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">Gateway health</h3>
        <Button size="sm" variant="ghost" disabled={health.isFetching} onClick={() => void health.refetch()}>
          <RefreshCw className={health.isFetching ? "size-4 animate-spin" : "size-4"} />
          Check again
        </Button>
      </div>
      {health.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">Checking the gateway…</p>
      ) : health.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {health.error instanceof Error && health.error.message ? health.error.message : "Couldn't check the gateway."}
        </p>
      ) : (
        <>
          {health.data.gatewayError ? (
            <p role="alert" className="text-sm text-destructive">{health.data.gatewayError}</p>
          ) : null}
          <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
            {openwaHealthRows(health.data).map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{row.label}</dt>
                <dd className={row.attention ? "font-mono text-destructive" : "font-mono"}>{row.value}</dd>
              </div>
            ))}
          </dl>
          {health.data.gatewayVersion !== null && health.data.gatewayVersion !== health.data.pinnedVersion ? (
            <p className="text-xs text-muted-foreground">
              Paperclip is tested with OpenWA <span className="font-mono">{health.data.pinnedVersion}</span>; some operations may behave differently.
            </p>
          ) : null}
          {endpoint.status === "attention" && (endpoint.lastError ?? endpoint.healthMessage) ? (
            <p className="text-xs text-destructive">{endpoint.lastError ?? endpoint.healthMessage}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Checked <time className="font-mono" dateTime={health.data.checkedAt}>{formatDateTime(health.data.checkedAt, { includeSeconds: true })}</time>
          </p>
        </>
      )}
    </section>
  );
}
