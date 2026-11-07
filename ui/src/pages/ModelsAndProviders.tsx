import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw } from "lucide-react";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { OMP_ADAPTER_TYPE, useOmpModels } from "@/components/omp-settings/omp-settings-model";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";

export function ModelsAndProviders() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const models = useOmpModels(selectedCompanyId);
  const [checking, setChecking] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Settings", href: "/company/settings" }, { label: "Models and providers" }]);
  }, [setBreadcrumbs]);

  const providers = useMemo(() => {
    const counts = new Map<string, number>();
    for (const model of models.data ?? []) {
      const provider = model.provider ?? model.id.split("/")[0] ?? "";
      counts.set(provider, (counts.get(provider) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models.data]);

  const checkAgain = async () => {
    if (!selectedCompanyId) return;
    setChecking(true);
    try {
      const fresh = await agentsApi.adapterModels(selectedCompanyId, OMP_ADAPTER_TYPE, { refresh: true });
      queryClient.setQueryData(queryKeys.agents.adapterModels(selectedCompanyId, OMP_ADAPTER_TYPE), fresh);
    } finally {
      setChecking(false);
    }
  };

  if (!selectedCompanyId) return null;

  return (
    <div className="max-w-4xl space-y-5 pb-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Models and providers</h1>
          <p className="text-sm text-ink-3">Imported from OMP. Keys stay in OMP's credential store; Paperclip never reads or keeps them.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" variant="secondary" size="sm" disabled={checking} onClick={checkAgain}>
            <RefreshCw aria-hidden="true" className={checking ? "motion-safe:animate-spin" : undefined} />
            Check again
          </Button>
          <Button type="button" size="sm" onClick={() => setShowAdd((open) => !open)} aria-expanded={showAdd}>
            <Plus aria-hidden="true" />
            Add provider
          </Button>
        </div>
      </div>

      {showAdd ? (
        <div className="space-y-2 rounded-lg border border-line bg-bg-2 px-4 py-3 text-sm sm:px-5">
          <p>Sign in on the machine where agents run. OMP opens the provider's sign-in page or asks for a key, and stores it itself.</p>
          <pre className="overflow-x-auto rounded-md bg-bg-3 px-3 py-2 font-mono text-xs">omp login</pre>
          <p className="text-ink-3">Then press Check again.</p>
        </div>
      ) : null}

      {models.error ? (
        <div role="alert" className="rounded-md border border-warn px-3 py-2 text-sm text-ink-2">
          OMP did not answer: {models.error.message}. Check that omp is installed and on the server's PATH.
        </div>
      ) : null}

      <section aria-labelledby="providers-title" className="overflow-hidden rounded-lg border border-line bg-bg-2">
        <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-2.5 sm:px-5">
          <h2 id="providers-title" className="text-xs font-semibold uppercase tracking-wide text-ink-3">Providers</h2>
          <span className="text-xs text-ink-3">{models.data ? `${models.data.length} models` : ""}</span>
        </div>
        {models.isLoading ? (
          <p className="px-4 py-3 text-sm text-ink-3 sm:px-5">Asking OMP...</p>
        ) : providers.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-3 sm:px-5">OMP reports no signed-in provider yet. Use Add provider.</p>
        ) : (
          <div className="px-4 sm:px-5">
            <table aria-label="Providers" className="stack-table w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ink-3">
                  <th className="py-2 font-medium">Provider</th>
                  <th className="py-2 font-medium">Models</th>
                  <th className="py-2 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(([provider, count]) => (
                  <tr key={provider} className="border-t border-line">
                    <td data-cell="title" className="font-medium">{provider}</td>
                    <td data-cell="meta" data-label="Models">{count}</td>
                    <td data-cell="end" className="text-right">
                      <span className="inline-flex items-center gap-1.5 text-ok">
                        <span aria-hidden="true" className="size-2 rounded-full bg-ok" />
                        Signed in
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
