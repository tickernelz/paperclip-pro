import type {
  IssueRunModelOverridePropagation,
  IssueRunModelOverrideSubtaskScope,
} from "@tickernelz/paperclip-pro-shared";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { MODEL_OVERRIDE_SCOPES } from "@/lib/model-override-scopes";
import { cn } from "@/lib/utils";

export function ModelOverrideSubtaskRows({
  inheritToSubtasks,
  subtaskScope,
  onInheritChange,
  onScopeChange,
  testIdPrefix,
  disabled = false,
  propagation = null,
  className,
}: {
  inheritToSubtasks: boolean;
  subtaskScope: IssueRunModelOverrideSubtaskScope;
  onInheritChange: (next: boolean) => void;
  onScopeChange: (next: IssueRunModelOverrideSubtaskScope) => void;
  testIdPrefix: string;
  disabled?: boolean;
  propagation?: IssueRunModelOverridePropagation | null;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 p-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs">Apply to subtasks</span>
        <ToggleSwitch
          checked={inheritToSubtasks}
          onCheckedChange={onInheritChange}
          disabled={disabled}
          data-testid={`${testIdPrefix}-inherit`}
        />
      </div>
      {inheritToSubtasks ? (
        <div className="flex items-center gap-1" role="radiogroup">
          {MODEL_OVERRIDE_SCOPES.map((scope) => (
            <button
              key={scope.value}
              type="button"
              role="radio"
              aria-checked={subtaskScope === scope.value}
              disabled={disabled}
              data-testid={`${testIdPrefix}-scope-${scope.value}`}
              className={cn(
                "flex-1 rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-accent/40 disabled:opacity-50",
                subtaskScope === scope.value && "bg-accent text-foreground",
              )}
              onClick={() => onScopeChange(scope.value)}
            >
              {scope.label}
            </button>
          ))}
        </div>
      ) : null}
      {propagation ? (
        <div className="flex flex-col gap-0.5 px-1">
          <p
            className="text-xs text-muted-foreground"
            data-testid={`${testIdPrefix}-propagation`}
          >
            {propagation.applied} of {propagation.visited} subtasks updated
            {propagation.skipped > 0
              ? ` · ${propagation.skipped} kept their own model`
              : ""}
          </p>
          {propagation.limitReached ? (
            <p
              className="text-xs text-amber-600 dark:text-amber-400"
              role="status"
              data-testid={`${testIdPrefix}-propagation-warning`}
            >
              Stopped at the safety limit; deeper subtasks were left unchanged.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
