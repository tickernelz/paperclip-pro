import { useRef, useState } from "react";
import type { IssueWorkMode } from "@tickernelz/paperclip-pro-shared";
import {
  Check,
  ClipboardList,
  Lock,
  MessageCircleQuestion,
  Paperclip,
  Plus,
  Target,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileEntityPickerViewportStyle } from "@/hooks/useMobileEntityPickerViewportStyle";
import { workModeMetaFor } from "@/lib/work-mode-meta";
import { useMobileViewportInsets } from "@/hooks/useMobileViewportInsets";
import { MobilePickerSheetHeader } from "@/components/ui/mobile-picker-sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ComposerAddMenuProps {
  mode: IssueWorkMode;
  onModeChange?: (mode: IssueWorkMode) => void;
  onAttachFile?: () => void;
  attachDisabled?: boolean;
  onGoal?: () => void;
  privacy?: { private: boolean; inherited?: string; onChange: (value: boolean) => void };
  disabled?: boolean;
  mobile?: boolean;
  triggerTestId?: string;
  menuTestId?: string;
}

interface AddMenuAction {
  id: string;
  label: string;
  detail?: string;
  Icon: LucideIcon;
  select: () => void;
  disabled?: boolean;
  selected?: boolean;
}

export function ComposerAddMenu({
  mode,
  onModeChange,
  onAttachFile,
  attachDisabled,
  onGoal,
  privacy,
  disabled,
  mobile = false,
  triggerTestId,
  menuTestId,
}: ComposerAddMenuProps) {
  const [open, setOpen] = useState(false);
  const mobileViewportStyle = useMobileEntityPickerViewportStyle();
  const goalFocusRef = useRef(false);
  useMobileViewportInsets(open, { sheet: true });
  if (!onModeChange && !onAttachFile && !onGoal && !privacy) return null;
  const actions: AddMenuAction[] = [
    ...(onAttachFile
      ? [
          {
            id: "composer-add-file",
            label: "Files and images",
            Icon: Paperclip,
            select: onAttachFile,
            disabled: attachDisabled,
          },
        ]
      : []),
    ...(privacy
      ? [
          {
            id: "composer-add-private",
            label: "Private task",
            detail: privacy.inherited,
            Icon: Lock,
            select: () => privacy.onChange(!privacy.private),
            selected: privacy.private,
            disabled: Boolean(privacy.inherited),
          },
        ]
      : []),
    ...(onGoal
      ? [
          {
            id: "composer-add-goal",
            label: "Goal",
            detail: "Keep pursuing",
            Icon: Target,
            select: onGoal,
          },
        ]
      : []),
    ...(onModeChange
      ? [
          {
            id: "composer-add-plan",
            label: "Plan mode",
            detail: "Plan before acting",
            Icon: ClipboardList,
            select: () => onModeChange(mode === "planning" ? "standard" : "planning"),
            selected: mode === "planning",
          },
          {
            id: "composer-add-ask",
            label: "Ask mode",
            detail: "Answer without changes",
            Icon: MessageCircleQuestion,
            select: () => onModeChange(mode === "ask" ? "standard" : "ask"),
            selected: mode === "ask",
          },
        ]
      : []),
  ];

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Add to composer"
          aria-keyshortcuts={
            onModeChange ? "Meta+Period Control+Period Shift+Tab" : undefined
          }
          disabled={disabled}
          data-testid={triggerTestId}
          data-slot="icon-button"
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="start"
        sideOffset={8}
        data-mobile-entity-picker=""
        data-testid={menuTestId}
        className="w-(--sz-300px) max-w-full rounded-xl p-1.5 shadow-sm"
        onCloseAutoFocus={(event) => {
          if (!goalFocusRef.current) return;
          event.preventDefault();
          goalFocusRef.current = false;
        }}
      >
        <MobilePickerSheetHeader title="Add" onClose={() => setOpen(false)} />
        <div data-mobile-sheet-body="" className="flex min-w-0 flex-col">
          <div className="px-2 py-1 text-xs text-muted-foreground max-sm:hidden">
            Add
          </div>
          <div data-slot="entity-option-list" className="min-w-0">
            {actions.map((action) => (
              <DropdownMenuItem
                key={action.id}
                onSelect={() => {
                  goalFocusRef.current = action.id === "composer-add-goal";
                  action.select();
                }}
                disabled={action.disabled}
                data-testid={action.id}
                className={cn(mobile && "min-h-11")}
              >
                <action.Icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span>{action.label}</span>
                  {action.detail ? (
                    <span className="truncate text-xs text-muted-foreground">
                      {action.detail}
                    </span>
                  ) : null}
                </span>
                {action.selected ? (
                  <Check className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : null}
              </DropdownMenuItem>
            ))}
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface ComposerModeChipProps {
  mode: IssueWorkMode;
  onRemove?: () => void;
  disabled?: boolean;
  testId?: string;
  mobile?: boolean;
}

export function ComposerModeChip({
  mode,
  onRemove,
  disabled,
  testId,
  mobile = false,
}: ComposerModeChipProps) {
  if (mode === "standard") return null;
  const meta = workModeMetaFor(mode);
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onRemove}
      disabled={disabled || !onRemove}
      aria-label={`Remove ${meta.label}`}
      data-pending-work-mode={mode}
      data-slot="task-chat-mode-trigger"
      data-testid={testId}
      className={cn(
        "inline-flex h-8 shrink-0 items-center rounded-full border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        mobile ? "gap-1 px-2" : "gap-1 px-2 sm:gap-1.5 sm:px-2.5",
        meta.classes.chip,
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className={mobile ? "sr-only" : "max-sm:sr-only"}>{meta.label}</span>
      <X className="size-3.5" aria-hidden />
    </button>
  );
}

export function ComposerPrivacyChip({ inherited, onRemove, disabled }: { inherited?: string; onRemove: () => void; disabled?: boolean }) {
  const [hintOpen, setHintOpen] = useState(false);
  const explanation = inherited ?? "Only you and people you share with can read this task";
  return <TooltipProvider><Tooltip open={hintOpen} onOpenChange={setHintOpen}>
    <TooltipTrigger asChild>
      <span className="inline-flex shrink-0" role={inherited ? "button" : undefined}
        tabIndex={inherited ? 0 : undefined} aria-label={inherited ? explanation : undefined}
        onClick={inherited ? (event) => { event.preventDefault(); setHintOpen(true); } : undefined}
        onKeyDown={inherited ? (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setHintOpen(true); }
        } : undefined}>
        <button type="button" onClick={onRemove} aria-label={inherited ? "Private task" : "Remove private task"}
          title={explanation}
          disabled={disabled || Boolean(inherited)} data-testid="composer-private-chip"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 text-xs font-medium text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50">
          <Lock className="size-3.5" aria-hidden />
          <span className="max-sm:sr-only">Private</span>
          {!inherited ? <X className="size-3.5" aria-hidden /> : null}
        </button>
      </span>
    </TooltipTrigger>
    <TooltipContent className="max-w-xs">{explanation}</TooltipContent>
  </Tooltip></TooltipProvider>;
}
