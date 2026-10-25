import {
  LOCAL_BROWSER_LIMIT_DEFAULTS,
  LOCAL_BROWSER_LIMIT_KEYS,
  LOCAL_BROWSER_LIMITS,
  type LocalBrowserLimitKey,
  type LocalBrowserLimits,
} from "@tickernelz/paperclip-pro-shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIB = 1_048_576;

interface LimitField {
  label: string;
  unit: string;
  scale: number;
  help: string;
}

const LIMIT_FIELDS: Record<LocalBrowserLimitKey, LimitField> = {
  resultMaxChars: {
    label: "Tool result size",
    unit: "chars",
    scale: 1,
    help: "Largest answer one browser tool call hands back to the agent.",
  },
  snapshotMaxNodes: {
    label: "Snapshot size",
    unit: "nodes",
    scale: 1,
    help: "Most page elements one snapshot lists.",
  },
  readMaxChars: {
    label: "Page read length",
    unit: "chars",
    scale: 1,
    help: "Most page text one read returns.",
  },
  screenshotMaxBytes: {
    label: "Screenshot size",
    unit: "MiB",
    scale: MIB,
    help: "Largest screenshot image the browser sends.",
  },
  transferMaxBytes: {
    label: "Upload and download size",
    unit: "MiB",
    scale: MIB,
    help: "Largest file moved between a task and the browser.",
  },
  callMaxMs: {
    label: "Call time limit",
    unit: "seconds",
    scale: 1_000,
    help: "Longest one browser call may run before it stops.",
  },
  networkMaxEntries: {
    label: "Network log entries",
    unit: "entries",
    scale: 1,
    help: "Most requests one network read returns.",
  },
};

export type LocalBrowserLimitDrafts = Record<LocalBrowserLimitKey, string>;

type ParsedLimit = { ok: true; value: number } | { ok: false; error: string };

function inUnit(key: LocalBrowserLimitKey, value: number): number {
  return Number((value / LIMIT_FIELDS[key].scale).toFixed(4));
}

function formatInUnit(key: LocalBrowserLimitKey, value: number): string {
  return inUnit(key, value).toLocaleString("en-US", { maximumFractionDigits: 4 });
}

export function limitDraftsFrom(limits: Partial<LocalBrowserLimits> | undefined): LocalBrowserLimitDrafts {
  const merged = { ...LOCAL_BROWSER_LIMIT_DEFAULTS, ...limits };
  return Object.fromEntries(
    LOCAL_BROWSER_LIMIT_KEYS.map((key) => [key, String(inUnit(key, merged[key]))]),
  ) as LocalBrowserLimitDrafts;
}

export function parseLimitDraft(key: LocalBrowserLimitKey, draft: string): ParsedLimit {
  const field = LIMIT_FIELDS[key];
  const range = LOCAL_BROWSER_LIMITS[key];
  const text = draft.trim();
  const amount = text ? Number(text) : Number.NaN;
  if (!Number.isFinite(amount)) return { ok: false, error: `Enter a number of ${field.unit}.` };
  const value = Math.round(amount * field.scale);
  if (value < range.min || value > range.ceiling) {
    return {
      ok: false,
      error: `Use ${formatInUnit(key, range.min)} to ${formatInUnit(key, range.ceiling)} ${field.unit}.`,
    };
  }
  return { ok: true, value };
}

export function parseLimitDrafts(drafts: LocalBrowserLimitDrafts): {
  limits: LocalBrowserLimits | null;
  errors: Partial<Record<LocalBrowserLimitKey, string>>;
} {
  const limits = { ...LOCAL_BROWSER_LIMIT_DEFAULTS };
  const errors: Partial<Record<LocalBrowserLimitKey, string>> = {};
  for (const key of LOCAL_BROWSER_LIMIT_KEYS) {
    const parsed = parseLimitDraft(key, drafts[key]);
    if (parsed.ok) limits[key] = parsed.value;
    else errors[key] = parsed.error;
  }
  return { limits: Object.keys(errors).length > 0 ? null : limits, errors };
}

export function LocalBrowserLimitsFields({
  idPrefix,
  drafts,
  disabled,
  onChange,
}: {
  idPrefix: string;
  drafts: LocalBrowserLimitDrafts;
  disabled?: boolean;
  onChange: (key: LocalBrowserLimitKey, draft: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {LOCAL_BROWSER_LIMIT_KEYS.map((key) => {
        const field = LIMIT_FIELDS[key];
        const range = LOCAL_BROWSER_LIMITS[key];
        const inputId = `${idPrefix}-limit-${key}`;
        const parsed = parseLimitDraft(key, drafts[key]);
        const error = parsed.ok ? null : parsed.error;
        const isDefault = parsed.ok && parsed.value === range.default;
        return (
          <div key={key} className="space-y-1" data-limit={key}>
            <Label htmlFor={inputId}>{field.label}</Label>
            <div className="flex items-center gap-2">
              <Input
                id={inputId}
                inputMode="decimal"
                value={drafts[key]}
                disabled={disabled}
                aria-invalid={error ? true : undefined}
                aria-describedby={`${inputId}-hint${error ? ` ${inputId}-error` : ""}`}
                onChange={(event) => onChange(key, event.target.value)}
                className="w-32 font-mono"
              />
              <span className="text-sm text-muted-foreground">{field.unit}</span>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Reset ${field.label} to default`}
                disabled={disabled || isDefault}
                onClick={() => onChange(key, String(inUnit(key, range.default)))}
              >
                Reset
              </Button>
            </div>
            <p id={`${inputId}-hint`} className="text-xs text-muted-foreground">
              {field.help} Default {formatInUnit(key, range.default)} {field.unit}, allowed{" "}
              {formatInUnit(key, range.min)} to {formatInUnit(key, range.ceiling)}.
            </p>
            {error ? (
              <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
