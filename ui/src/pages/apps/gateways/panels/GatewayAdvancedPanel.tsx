import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import type { ToolMcpGatewayWithTokens } from "@tickernelz/paperclip-pro-shared";
import { useNavigate } from "@/lib/router";
import { toolsApi } from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { gatewaysQueryKey } from "../NewGatewayDialog";

/**
 * Advanced tab — raw protocol/transport details, config JSON and the archive
 * (destructive) action live here, out of the default prosumer view per the
 * PAP-11174 contract's default-vs-Advanced split.
 */
export function GatewayAdvancedPanel({
  companyId,
  gateway,
}: {
  companyId: string;
  gateway: ToolMcpGatewayWithTokens;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}${gateway.endpointPath}`;
  const rawConfig = JSON.stringify(
    {
      gatewayPublicId: gateway.gatewayPublicId,
      displaySlug: gateway.displaySlug,
      status: gateway.status,
      profileId: gateway.profileId,
      defaultProfileMode: gateway.defaultProfileMode,
      contextScopeType: gateway.contextScopeType,
      contextScopeId: gateway.contextScopeId,
      endpointPath: gateway.endpointPath,
      authConfig: gateway.authConfig,
      headerPolicy: gateway.headerPolicy,
      metadataPolicy: gateway.metadataPolicy,
      onDemandToolsConfig: gateway.onDemandToolsConfig,
    },
    null,
    2,
  );

  const archiveMutation = useMutation({
    mutationFn: () => toolsApi.updateGateway(companyId, gateway.id, { status: "archived" }),
    onSuccess: async () => {
      pushToast({ title: "Gateway archived", body: `${gateway.name} is no longer reachable.`, tone: "success" });
      await queryClient.invalidateQueries({ queryKey: gatewaysQueryKey(companyId) });
      navigate("/apps/gateways");
    },
    onError: (error) =>
      pushToast({
        title: "Couldn't archive the gateway",
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      }),
  });

  async function copy(value: string, label: string) {
    try {
      await copyTextToClipboard(value);
      pushToast({ title: "Copied", body: label, tone: "success" });
    } catch {
      pushToast({ title: "Copy failed", body: "Clipboard access is unavailable.", tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-ink">Transport</h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Transport" value="streamable_http" />
          <Row label="Authentication" value="bearer" />
          <Row label="Protocol version" value="2025-03-26" />
          <Row label="Public ID" value={gateway.gatewayPublicId} mono />
        </dl>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-bg-3 px-3 py-2 font-mono text-xs text-ink-3">
            {endpoint}
          </code>
          <Button variant="secondary" size="sm" onClick={() => void copy(endpoint, "Endpoint URL")}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Raw configuration</h3>
          <Button variant="secondary" size="sm" onClick={() => void copy(rawConfig, "Gateway config JSON")}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            Copy JSON
          </Button>
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-3 p-3 font-mono text-xs text-ink-3">
          {rawConfig}
        </pre>
      </section>

      <section className="space-y-2 rounded-lg border border-bad/40 p-4">
        <h3 className="text-sm font-semibold text-bad">Danger zone</h3>
        <p className="text-sm text-ink-3">
          Archiving takes the gateway offline for every client. Existing tokens stop working. Type the
          gateway name to confirm.
        </p>
        {confirming ? (
          <div className="space-y-2">
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={gateway.name}
              aria-label="Type the gateway name to confirm archive"
            />
            <div className="flex gap-2">
              <Button
                variant="danger"
                size="sm"
                disabled={confirmName.trim() !== gateway.name || archiveMutation.isPending}
                onClick={() => archiveMutation.mutate()}
              >
                {archiveMutation.isPending ? "Archiving…" : "Archive gateway"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfirming(false); setConfirmName(""); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>
            Archive gateway
          </Button>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-3">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-ink" : "mt-0.5 text-ink"}>{value}</dd>
    </div>
  );
}
