import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "file:text-ink placeholder:text-ink-3 selection:bg-accent selection:text-accent-ink dark:bg-line-strong/30 border-line-strong h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-(--tp-color-box-shadow) outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-focus focus-visible:ring-focus/50 focus-visible:ring-(length:--rad-3)",
        "aria-invalid:ring-bad/20 dark:aria-invalid:ring-bad/40 aria-invalid:border-bad",
        className
      )}
      {...props}
    />
  )
}

export { Input }
