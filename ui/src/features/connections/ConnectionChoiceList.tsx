import type { ReactNode } from "react";
import { Check, ChevronRight, Loader2 } from "lucide-react";

/** The account-reuse rows shared by connection setup and agent bindings. */
export function ConnectionChoiceList({ choices, selectedId, pendingId, disabled, onSelect }: {
  choices: { id: string; name: string; description: ReactNode; icon?: ReactNode; disabled?: boolean }[];
  selectedId?: string;
  pendingId?: string | null;
  disabled?: boolean;
  onSelect: (id: string) => void;
}) {
  return <div className="space-y-2">
    {choices.map((choice) => <button
      key={choice.id}
      type="button"
      className="flex w-full items-center justify-between gap-4 rounded-lg border border-line bg-bg-2 p-4 text-left transition-colors hover:bg-bg-3 disabled:cursor-not-allowed disabled:opacity-60"
      aria-label={choice.name}
      aria-pressed={selectedId === undefined ? undefined : selectedId === choice.id}
      disabled={disabled || Boolean(pendingId) || choice.disabled}
      onClick={() => onSelect(choice.id)}
    >
      {choice.icon && <span aria-hidden="true" className="shrink-0">{choice.icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-ink">{choice.name}</span>
        <span className="mt-1 block text-xs text-ink-3">{choice.description}</span>
      </span>
      {pendingId === choice.id ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-3" />
        : selectedId === choice.id ? <Check className="h-4 w-4 shrink-0 text-ink-3" />
        : <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" />}
    </button>)}
  </div>;
}
