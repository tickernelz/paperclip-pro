import * as React from "react"

import { cn } from "@/lib/utils"

function Chip({
  selected = false,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type={type}
      data-slot="chip"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border border-line-strong bg-bg-2 px-3 text-(length:--t-13) font-medium text-ink-2 transition-(--tp-color-background-color-border-color-box-shadow-opacity) outline-hidden hover:bg-bg-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:bg-bg-3 disabled:text-ink-3 aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-accent aria-pressed:hover:bg-accent-soft aria-pressed:hover:text-accent [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  )
}

export { Chip }
