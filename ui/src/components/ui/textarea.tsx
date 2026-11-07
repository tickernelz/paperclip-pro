import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-line-strong placeholder:text-ink-3 focus-visible:border-focus focus-visible:ring-focus/50 aria-invalid:ring-bad/20 dark:aria-invalid:ring-bad/40 aria-invalid:border-bad dark:bg-line-strong/30 flex field-sizing-content min-h-16 min-w-0 w-full max-w-full rounded-md border bg-transparent px-3 py-2 text-base shadow-xs transition-(--tp-color-box-shadow) outline-none focus-visible:ring-(length:--rad-3) disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
