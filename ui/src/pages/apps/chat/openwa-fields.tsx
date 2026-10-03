import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import type { FieldErrors } from "./openwa-settings-model";

export const openwaSelectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50";

export function fieldError(errors: FieldErrors, key: string): string | undefined {
  if (errors[key]) return errors[key];
  const nested = Object.keys(errors).find((candidate) => candidate.startsWith(key + "."));
  return nested ? errors[nested] : undefined;
}

export function FieldMessage({ id, error }: { id: string; error?: string }) {
  return error ? (
    <p id={id + "-error"} role="alert" className="text-xs text-destructive">
      {error}
    </p>
  ) : null;
}

export function SettingsSection({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section aria-label={title} className="space-y-3 rounded-lg border border-border p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {children}
      {footer}
    </section>
  );
}

export function NumberField({
  id,
  label,
  help,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  error?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {help ? <p className="text-xs text-muted-foreground">{help}</p> : null}
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        className="max-w-xs font-mono"
        value={value}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? id + "-error" : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export function ToggleRow({
  label,
  detail,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
      </div>
      <ToggleSwitch aria-label={label} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}
