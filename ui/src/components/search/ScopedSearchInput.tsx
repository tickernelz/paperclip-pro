import { startTransition, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, Ref } from "react";
import { Search, X } from "lucide-react";
import {
  COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
} from "@tickernelz/paperclip-pro-shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { updatedWithinLabel } from "@/lib/search-filters";
import {
  SCOPED_SEARCH_FIELDS,
  SEARCH_OPERATOR_KEYS,
  currentSearchToken,
  formatSearchToken,
  parseSearchQuery,
  searchTokenPill,
  splitSearchInput,
  type ParsedSearchQuery,
  type ScopedSearchFieldDefinition,
  type ScopedSearchFieldKey,
  type SearchOperatorKey,
  type SearchQueryParserContext,
} from "@/lib/search-query-parser";

export const SCOPED_SEARCH_DEBOUNCE_MS = 250;
export const SCOPED_SEARCH_PLACEHOLDER = 'Search title, ID, description… (pick a field or type "exact phrase")';

export interface ScopedSearchValue {
  raw: string;
  q: string;
  filters: ParsedSearchQuery["filters"];
}

interface ScopedSearchOption {
  id: string;
  label: string;
  description?: string;
  token?: string;
  field?: ScopedSearchFieldDefinition;
}

export interface ScopedSearchInputProps {
  value: string;
  onChange: (value: ScopedSearchValue) => void;
  context?: SearchQueryParserContext;
  operatorKeys?: readonly SearchOperatorKey[];
  debounceMs?: number;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  fieldClassName?: string;
  inputClassName?: string;
  clearOnEscape?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  autoFocus?: boolean;
  pageSearchTarget?: boolean;
  trailing?: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
}

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function composeRaw(
  tokens: readonly string[],
  pending: ScopedSearchFieldDefinition | null,
  draft: string,
  heldText = "",
) {
  const tail = pending
    ? (pending.kind === "text" && draft.trim() ? formatSearchToken(pending.key, draft) : "")
    : draft;
  return [...tokens, heldText, tail].filter((part) => part.trim().length > 0).join(" ");
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) (ref as { current: T | null }).current = value;
}

function pickerOptions(
  key: ScopedSearchFieldKey,
  context: SearchQueryParserContext,
  operatorKeys: readonly SearchOperatorKey[],
): ScopedSearchOption[] {
  const hasSelf = Boolean(context.currentUserId || context.currentAgentId);
  switch (key) {
    case "status":
      return [
        ...ISSUE_STATUSES.map((status) => ({ id: status, label: humanize(status), token: `status:${status}` })),
        ...(operatorKeys.includes("is")
          ? [
            { id: "is:open", label: "Open", description: "Any open status", token: "is:open" },
            { id: "is:closed", label: "Closed", description: "Done or cancelled", token: "is:closed" },
          ]
          : []),
      ];
    case "priority":
      return ISSUE_PRIORITIES.map((priority) => ({ id: priority, label: humanize(priority), token: `priority:${priority}` }));
    case "assignee":
      return [
        ...(hasSelf ? [{ id: "me", label: "Me", token: "assignee:me" }] : []),
        { id: "none", label: "Unassigned", token: "assignee:none" },
        ...(context.agents ?? []).map((agent) => ({ id: agent.id, label: agent.name, token: formatSearchToken("assignee", agent.name) })),
      ];
    case "author":
      return [
        ...(hasSelf ? [{ id: "me", label: "Me", token: "author:me" }] : []),
        ...(context.agents ?? []).map((agent) => ({ id: agent.id, label: agent.name, token: formatSearchToken("author", agent.name) })),
      ];
    case "label":
      return (context.labels ?? []).map((label) => ({ id: label.id, label: label.name, token: formatSearchToken("label", label.name) }));
    case "project":
      return (context.projects ?? []).map((project) => ({ id: project.id, label: project.name, token: formatSearchToken("project", project.name) }));
    case "updated":
      return COMPANY_SEARCH_UPDATED_WITHIN_OPTIONS.map((option) => ({ id: option, label: updatedWithinLabel(option), token: `updated:>${option}` }));
    default:
      return [];
  }
}

function rankOptions(options: ScopedSearchOption[], needle: string) {
  if (!needle) return options;
  const prefix: ScopedSearchOption[] = [];
  const contains: ScopedSearchOption[] = [];
  for (const option of options) {
    const label = option.label.toLowerCase();
    if (label.startsWith(needle) || option.id.toLowerCase().startsWith(needle)) prefix.push(option);
    else if (label.includes(needle)) contains.push(option);
  }
  return [...prefix, ...contains];
}

/** Debounced search box with field pills; emits the raw query plus parsed q and filters. */
export function ScopedSearchInput({
  value,
  onChange,
  context = {},
  operatorKeys = SEARCH_OPERATOR_KEYS,
  debounceMs = SCOPED_SEARCH_DEBOUNCE_MS,
  placeholder = SCOPED_SEARCH_PLACEHOLDER,
  ariaLabel = "Search",
  className,
  fieldClassName,
  inputClassName,
  clearOnEscape = false,
  inputRef,
  autoFocus,
  pageSearchTarget,
  trailing,
  onKeyDown,
}: ScopedSearchInputProps) {
  const listId = useId();
  const localInputRef = useRef<HTMLInputElement | null>(null);
  const [tokens, setTokens] = useState<string[]>(() => splitSearchInput(value, operatorKeys).tokens);
  const [draft, setDraft] = useState(() => splitSearchInput(value, operatorKeys).text);
  const [pending, setPending] = useState<ScopedSearchFieldDefinition | null>(null);
  const [heldText, setHeldText] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const lastEmittedRef = useRef(value);
  const contextRef = useRef(context);
  contextRef.current = context;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const operatorKeysRef = useRef(operatorKeys);
  operatorKeysRef.current = operatorKeys;

  const fields = useMemo(
    () => SCOPED_SEARCH_FIELDS.filter((field) => field.kind === "text" || operatorKeys.includes(field.key as SearchOperatorKey)),
    [operatorKeys],
  );
  const raw = composeRaw(tokens, pending, draft, pending ? heldText : "");

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const next = splitSearchInput(value, operatorKeysRef.current);
    setTokens(next.tokens);
    setDraft(next.text);
    setPending(null);
    setHeldText("");
  }, [value]);

  const emit = useCallback((nextRaw: string) => {
    lastEmittedRef.current = nextRaw;
    const parsed = parseSearchQuery(nextRaw, { ...contextRef.current, operatorKeys: operatorKeysRef.current });
    const payload = { raw: nextRaw, q: parsed.query, filters: parsed.filters };
    if (debounceMs <= 0) onChangeRef.current(payload);
    else startTransition(() => onChangeRef.current(payload));
  }, [debounceMs]);

  useEffect(() => {
    if (raw === lastEmittedRef.current) return;
    if (debounceMs <= 0) {
      emit(raw);
      return;
    }
    const handle = window.setTimeout(() => {
      if (raw !== lastEmittedRef.current) emit(raw);
    }, debounceMs);
    return () => window.clearTimeout(handle);
  }, [debounceMs, emit, raw]);

  const fieldByKey = useCallback(
    (key: string) => fields.find((field) => field.key === key.toLowerCase()) ?? null,
    [fields],
  );

  const options = useMemo<ScopedSearchOption[]>(() => {
    if (pending) {
      if (pending.kind === "text") return [];
      const needle = draft.trim().replace(/"/g, "").toLowerCase();
      return rankOptions(pickerOptions(pending.key, context, operatorKeys), needle);
    }
    const { token } = currentSearchToken(draft);
    if (token.includes(":") || token.startsWith("\"")) return [];
    const needle = token.toLowerCase();
    return fields
      .filter((field) => !needle || field.key.startsWith(needle) || field.label.toLowerCase().startsWith(needle))
      .map((field) => ({ id: field.key, label: field.label, description: field.description, field }));
  }, [context, draft, fields, operatorKeys, pending]);

  const listVisible = open && options.length > 0;

  useEffect(() => {
    setActiveIndex(pending && pending.kind === "picker" ? 0 : -1);
  }, [pending, draft]);

  const focusInput = () => localInputRef.current?.focus();

  const startField = (field: ScopedSearchFieldDefinition, remainingText: string) => {
    setHeldText(remainingText.trim());
    setPending(field);
    setDraft("");
    setOpen(true);
    focusInput();
  };

  const releaseHeldText = () => {
    setPending(null);
    setDraft(heldText ? `${heldText} ` : "");
    setHeldText("");
  };

  const commitToken = (token: string, keepOpen = true) => {
    setTokens((current) => [...current, token]);
    releaseHeldText();
    setOpen(keepOpen);
    focusInput();
  };

  const selectOption = (option: ScopedSearchOption, keepOpen = true) => {
    if (option.field) {
      startField(option.field, draft.slice(0, currentSearchToken(draft).start));
      return;
    }
    if (option.token) commitToken(option.token, keepOpen);
  };

  const handleDraftChange = (nextValue: string) => {
    const endsWithSpace = /\s$/.test(nextValue);
    if (endsWithSpace) setOpen(true);
    if (pending) {
      if (pending.kind === "text" && endsWithSpace) {
        const trimmed = nextValue.trim();
        const quoted = trimmed.startsWith("\"");
        if (trimmed && (!quoted || (trimmed.length > 1 && trimmed.endsWith("\"")))) {
          commitToken(formatSearchToken(pending.key, trimmed));
          return;
        }
      }
      if (pending.kind === "picker" && endsWithSpace) {
        const needle = nextValue.trim().toLowerCase();
        const exact = pickerOptions(pending.key, context, operatorKeys)
          .find((option) => option.label.toLowerCase() === needle || option.id.toLowerCase() === needle);
        if (exact?.token) {
          commitToken(exact.token);
          return;
        }
      }
      setDraft(nextValue);
      return;
    }
    const { start, token } = currentSearchToken(nextValue);
    const fieldMatch = /^([a-zA-Z]+):$/.exec(token);
    const field = fieldMatch ? fieldByKey(fieldMatch[1]!) : null;
    if (field) {
      startField(field, nextValue.slice(0, start));
      return;
    }
    const split = splitSearchInput(nextValue, operatorKeys, !endsWithSpace);
    if (split.tokens.length > 0) {
      setTokens((current) => [...current, ...split.tokens]);
      setDraft(split.text && endsWithSpace ? `${split.text} ` : split.text);
      return;
    }
    setDraft(nextValue);
  };

  const removeToken = (index: number) => {
    setTokens((current) => current.filter((_, tokenIndex) => tokenIndex !== index));
    focusInput();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const composing = event.nativeEvent.isComposing;
    if (!composing && event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (options.length > 0) setActiveIndex((index) => (index + 1) % options.length);
      return;
    }
    if (!composing && event.key === "ArrowUp" && listVisible) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? options.length - 1 : index - 1));
      return;
    }
    if (!composing && event.key === "Enter") {
      if (listVisible && activeIndex >= 0 && options[activeIndex]) {
        event.preventDefault();
        selectOption(options[activeIndex]!, false);
        return;
      }
      let nextRaw = raw;
      if (pending?.kind === "text" && draft.trim()) {
        const token = formatSearchToken(pending.key, draft);
        commitToken(token, false);
        nextRaw = composeRaw([...tokens, token], null, heldText);
      } else if (!pending) {
        const split = splitSearchInput(draft, operatorKeys);
        if (split.tokens.length > 0) {
          setTokens([...tokens, ...split.tokens]);
          setDraft(split.text);
          nextRaw = composeRaw([...tokens, ...split.tokens], null, split.text);
        }
      }
      if (nextRaw !== lastEmittedRef.current) emit(nextRaw);
      setOpen(false);
    }
    if (!composing && event.key === "Escape" && listVisible) {
      setOpen(false);
      if (draft.length > 0 || pending) {
        event.preventDefault();
        return;
      }
    }
    if (!composing && event.key === "Escape" && clearOnEscape && raw.length > 0) {
      event.preventDefault();
      setTokens([]);
      setPending(null);
      setHeldText("");
      setDraft("");
      lastEmittedRef.current = "";
      onChangeRef.current({ raw: "", q: "", filters: {} });
      return;
    }
    if (!composing && event.key === "Backspace" && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) {
      if (pending) {
        event.preventDefault();
        releaseHeldText();
        return;
      }
      if (tokens.length > 0) {
        event.preventDefault();
        setTokens((current) => current.slice(0, -1));
        return;
      }
    }
    onKeyDown?.(event);
  };

  const pills = tokens.map((token) => searchTokenPill(token, context));
  const inputPlaceholder = pending
    ? (pending.kind === "text" ? `${pending.label}: type text or "exact phrase", Enter to add` : `Pick ${pending.label.toLowerCase()}…`)
    : tokens.length > 0 ? "" : placeholder;

  return (
    <div className={cn("relative", className)} data-testid="scoped-search">
      <div
        className={cn(
          "flex h-8 w-full min-w-0 items-center gap-1 overflow-x-auto rounded-md border border-input bg-transparent pl-7 pr-1 shadow-xs focus-within:border-ring focus-within:ring-(length:--rad-3) focus-within:ring-ring/50 dark:bg-input/30",
          fieldClassName,
        )}
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) {
            event.preventDefault();
            focusInput();
          }
        }}
      >
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        {pills.map((pill, index) => (
          <Badge
            key={`${tokens[index]}:${index}`}
            variant="secondary"
            className="max-w-56 gap-1 pr-0.5 font-normal"
            data-testid="scoped-search-pill"
          >
            <span className="truncate">{pill.label}</span>
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-background/60"
              aria-label={`Remove ${pill.label}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => removeToken(index)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        {pending ? (
          <Badge variant="outline" className="gap-1 pr-0.5 font-normal" data-testid="scoped-search-pending-field">
            <span>{pending.key}:</span>
            <button
              type="button"
              className="rounded-full p-0.5 hover:bg-accent"
              aria-label={`Remove ${pending.label} field`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                releaseHeldText();
                focusInput();
              }}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ) : null}
        <input
          ref={(node) => {
            localInputRef.current = node;
            assignRef(inputRef, node);
          }}
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={listVisible}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listVisible && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoFocus={autoFocus}
          value={draft}
          placeholder={inputPlaceholder}
          data-page-search-target={pageSearchTarget ? "true" : undefined}
          className={cn(
            "h-full min-w-24 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground md:text-sm",
            inputClassName,
          )}
          onChange={(event) => handleDraftChange(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={handleKeyDown}
        />
        {trailing}
      </div>
      {listVisible ? (
        <div
          id={listId}
          role="listbox"
          aria-label={pending ? `${pending.label} values` : "Search fields"}
          className="absolute left-0 top-full z-50 mt-1 max-h-64 w-full min-w-56 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md"
          data-testid="scoped-search-options"
        >
          {options.map((option, index) => (
            <div
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-3 rounded-sm px-2 py-1.5 text-sm",
                index === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
              )}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span className="truncate">{option.label}</span>
              {option.description ? (
                <span className="hidden truncate text-xs text-muted-foreground sm:inline">{option.description}</span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
