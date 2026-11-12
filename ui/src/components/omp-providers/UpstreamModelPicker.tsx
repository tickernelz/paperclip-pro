import { memo, useMemo, useState } from "react";
import { OMP_CUSTOM_PROVIDER_MODEL_LIMIT, type OmpCustomProviderModelsFetchResult, type OmpUpstreamModel } from "@tickernelz/wardmote-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OmpNote } from "./OmpSignIn";

const SHOWN_LIMIT = 500;
const STALE_SHOWN = 10;

export const UpstreamModelPicker = memo(function UpstreamModelPicker({
  result,
  savedIds,
  room,
  onAdd,
}: {
  result: OmpCustomProviderModelsFetchResult;
  savedIds: ReadonlySet<string>;
  room: number;
  onAdd: (models: OmpUpstreamModel[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const fresh = useMemo(() => result.models.filter((model) => !savedIds.has(model.id)), [result.models, savedIds]);
  const stale = useMemo(() => {
    if (result.truncated) return [];
    const listed = new Set(result.models.map((model) => model.id));
    return [...savedIds].filter((id) => !listed.has(id));
  }, [result.models, result.truncated, savedIds]);
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? result.models.filter((model) => model.id.toLowerCase().includes(needle) || model.name?.toLowerCase().includes(needle))
      : result.models;
  }, [query, result.models]);
  const chosen = fresh.filter((model) => selected.has(model.id));

  function toggle(id: string, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function add(models: OmpUpstreamModel[]) {
    onAdd(models);
    setSelected(new Set());
  }

  const overLimit = (count: number) => count > room;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line-soft p-3" aria-label="Upstream models">
      <p className="text-sm">
        {result.url} lists {result.models.length} {result.models.length === 1 ? "model" : "models"}{result.truncated ? " (more exist; only these were read)" : ""}: {fresh.length} new, {result.models.length - fresh.length} already added.
      </p>
      {stale.length ? (
        <OmpNote tone="info">
          {stale.length} saved {stale.length === 1 ? "model is" : "models are"} not listed upstream and {stale.length === 1 ? "stays" : "stay"} until you remove {stale.length === 1 ? "it" : "them"}: {stale.slice(0, STALE_SHOWN).join(", ")}{stale.length > STALE_SHOWN ? `, and ${stale.length - STALE_SHOWN} more` : ""}.
        </OmpNote>
      ) : null}
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search upstream models" aria-label="Search upstream models" autoComplete="off" />
      <ul className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-line-soft">
        {matches.slice(0, SHOWN_LIMIT).map((model) => {
          const saved = savedIds.has(model.id);
          return (
            <li key={model.id} className="border-b border-line-soft last:border-b-0">
              <label className="flex items-center gap-2 px-2 py-1.5 text-sm">
                <input type="checkbox" checked={saved || selected.has(model.id)} disabled={saved} onChange={(event) => toggle(model.id, event.target.checked)} aria-label={model.id} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{model.id}</span>
                {model.name ? <span className="min-w-0 truncate text-xs text-ink-3">{model.name}</span> : null}
                {saved ? <span className="shrink-0 text-xs text-ink-3">Added</span> : null}
              </label>
            </li>
          );
        })}
        {matches.length === 0 ? <li className="px-2 py-1.5 text-sm text-ink-3">No upstream model matches.</li> : null}
      </ul>
      {matches.length > SHOWN_LIMIT ? <span className="text-xs text-ink-3">Showing {SHOWN_LIMIT} of {matches.length}; search to narrow the list.</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={chosen.length === 0 || overLimit(chosen.length)} onClick={() => add(chosen)}>
          Add selected{chosen.length ? ` (${chosen.length})` : ""}
        </Button>
        <Button type="button" variant="secondary" size="sm" disabled={fresh.length === 0 || overLimit(fresh.length)} onClick={() => add(fresh)}>
          Add all{fresh.length ? ` (${fresh.length})` : ""}
        </Button>
        {overLimit(Math.max(chosen.length, fresh.length)) ? <span className="text-xs text-ink-3">Only {room} more {room === 1 ? "model fits" : "models fit"}; a provider holds at most {OMP_CUSTOM_PROVIDER_MODEL_LIMIT}.</span> : null}
      </div>
    </div>
  );
});
