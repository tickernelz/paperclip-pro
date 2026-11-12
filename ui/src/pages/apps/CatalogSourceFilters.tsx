import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const CATALOG_SOURCES = ["wardmote", "composio", "arcade", "installed", "all"] as const;
export type CatalogSource = typeof CATALOG_SOURCES[number];
export const CATALOG_SOURCE_NAMES = { wardmote: "Wardmote", composio: "Composio", arcade: "Arcade", executor: "Executor", installed: "Installed", all: "All" };

export function CatalogSourceFilters({ source, onChange }: { source: CatalogSource; onChange: (source: CatalogSource) => void }) {
  return <nav aria-label="App filters" className="flex flex-wrap gap-1">
    {CATALOG_SOURCES.map(value => <Button active={value === source} key={value} variant="ghost" size="sm" aria-pressed={value === source}
      onClick={() => onChange(value)} className={cn("rounded-full px-4 font-normal")}>
      {CATALOG_SOURCE_NAMES[value]}
    </Button>)}
  </nav>;
}
