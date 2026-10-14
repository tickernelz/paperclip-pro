import type { IssueRunModelOverrideOption } from "@tickernelz/paperclip-pro-shared";
import { cn } from "@/lib/utils";

/** How a stored model value reads: display name, provider, and the full id. */
export interface ModelValueDisplay {
  name: string;
  provider: string | null;
  id: string;
}

/** A section of catalog options served by one provider; ungrouped options have no provider. */
export interface ModelOptionSection<T extends IssueRunModelOverrideOption> {
  provider: string | null;
  options: T[];
}

/** Resolves a value against the catalog, falling back to the full id when it is not listed. */
export function describeModelValue(
  value: string,
  options: readonly IssueRunModelOverrideOption[],
): ModelValueDisplay {
  const option = options.find((candidate) => candidate.value === value);
  const name = option ? optionDisplayName(option) : value;
  const provider = option?.group && name !== value ? option.group : null;
  return { name, provider, id: value };
}

const TRAILING_PARENTHETICAL = /\s*\(([^()]+)\)\s*$/;

function nameTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Drops a trailing "(tag)" from a name when the tag only repeats words of the provider id. */
export function withoutProviderTag(name: string, provider: string | null | undefined): string {
  if (!provider) return name;
  const match = TRAILING_PARENTHETICAL.exec(name);
  const stripped = match ? name.slice(0, match.index).trim() : "";
  if (!match || !stripped) return name;
  const providerWords = new Set(nameTokens(provider));
  const tagWords = nameTokens(match[1]!);
  return tagWords.length > 0 && tagWords.every((word) => providerWords.has(word)) ? stripped : name;
}

/** The option's display name, without its id or a provider tag that repeats its group. */
export function optionDisplayName(option: IssueRunModelOverrideOption): string {
  return withoutProviderTag(option.name ?? option.label, option.group);
}

/** One-line text for a value, naming the provider when it is known. */
export function modelValueText(display: ModelValueDisplay): string {
  return display.provider ? `${display.name} · ${display.provider}` : display.name;
}

/** Whether an option matches a search over its display name, label, id and provider. */
export function modelOptionMatches(option: IssueRunModelOverrideOption, query: string): boolean {
  const lowered = query.trim().toLowerCase();
  if (!lowered) return true;
  return [option.name, option.label, option.value, option.group].some((text) =>
    text?.toLowerCase().includes(lowered),
  );
}

/** Splits options into provider sections in catalog order. */
export function groupModelOptions<T extends IssueRunModelOverrideOption>(
  options: readonly T[],
): ModelOptionSection<T>[] {
  const sections = new Map<string, ModelOptionSection<T>>();
  for (const option of options) {
    const key = option.group ?? "";
    const section = sections.get(key) ?? { provider: option.group ?? null, options: [] };
    section.options.push(option);
    sections.set(key, section);
  }
  return [...sections.values()];
}

/** A value's display name with its provider underneath or as a badge, titled with the full id. */
export function ModelValueLabel({
  display,
  layout,
  testId,
  className,
  truncateName = false,
}: {
  display: ModelValueDisplay;
  layout: "stacked" | "inline";
  testId?: string;
  className?: string;
  /** Inline rows that sit beside other controls: the name truncates so the provider badge stays readable. */
  truncateName?: boolean;
}) {
  const providerTestId = testId ? `${testId}-provider` : undefined;
  if (layout === "stacked") {
    return (
      <span className={cn("block min-w-0", className)} title={display.id}>
        <span className="block truncate text-sm font-medium" data-testid={testId}>
          {display.name}
        </span>
        {display.provider ? (
          <span className="block truncate text-xs text-muted-foreground" data-testid={providerTestId}>
            {display.provider}
          </span>
        ) : null}
      </span>
    );
  }
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)} title={display.id}>
      <span
        className={cn("truncate", truncateName ? "min-w-0 flex-1" : "max-w-full shrink-0")}
        data-testid={testId}
      >
        {display.name}
      </span>
      {display.provider ? (
        <span
          className={cn(
            "max-w-(--sz-12rem) truncate rounded border border-border px-1 text-(length:--text-micro) leading-4 text-muted-foreground",
            truncateName ? "shrink-0" : "min-w-8",
          )}
          data-testid={providerTestId}
        >
          {display.provider}
        </span>
      ) : null}
    </span>
  );
}

/** An option row's display name with its full id muted underneath when they differ. */
export function ModelOptionText({ option }: { option: IssueRunModelOverrideOption }) {
  const name = optionDisplayName(option);
  return (
    <span className="min-w-0 flex-1" title={option.value}>
      <span className="block truncate">{name}</span>
      {option.value && name !== option.value ? (
        <span className="block truncate font-mono text-xs text-muted-foreground">{option.value}</span>
      ) : null}
    </span>
  );
}

/** A provider section heading inside an option list. */
export function ModelOptionGroupHeader({ provider, testId }: { provider: string; testId: string }) {
  return (
    <div
      role="presentation"
      className="px-2 pb-0.5 pt-2 text-(length:--text-micro) font-medium text-muted-foreground first:pt-1"
      data-testid={testId}
    >
      {provider}
    </div>
  );
}
