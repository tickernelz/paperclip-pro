import * as React from "react";
import { cn } from "@/lib/utils";

export interface ToggleSwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  size?: "default" | "lg";
}

export const ToggleSwitch = React.forwardRef<
  HTMLButtonElement,
  ToggleSwitchProps
>(
  (
    { checked, onCheckedChange, size = "default", className, disabled, onClick, ...props },
    ref,
  ) => {
    const isLg = size === "lg";

    return (
      <button
        ref={ref}
        type="button"
        role="switch"
        aria-checked={checked}
        data-slot="toggle"
        disabled={disabled}
        className={cn(
          "relative inline-flex shrink-0 items-center rounded-full border-2 transition-all outline-hidden",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
          "disabled:cursor-not-allowed disabled:border-line-strong disabled:bg-bg-3",
          isLg ? "h-6 w-12" : "h-5 w-11",
          checked ? "border-accent bg-accent" : "border-transparent bg-line-strong",
          className,
        )}
        {...props}
        // Run the caller's onClick first (e.g. stopPropagation in a clickable
        // row) but always fire the toggle — spreading `props` must not clobber
        // the state change, so this handler stays after the spread.
        onClick={(event) => {
          onClick?.(event);
          onCheckedChange(!checked);
        }}
      >
        <span
          className={cn(
            "pointer-events-none inline-block rounded-full bg-bg-2 shadow-sm transition-transform",
            isLg ? "h-5 w-7" : "h-4 w-6",
            checked ? "translate-x-4" : "translate-x-0",
          )}
        />
      </button>
    );
  },
);

ToggleSwitch.displayName = "ToggleSwitch";
