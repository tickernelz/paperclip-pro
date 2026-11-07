import * as React from "react"

import { cn } from "@/lib/utils"

function Segmented({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="segmented"
      className={cn("inline-flex items-center gap-0.5 rounded-md border border-line-strong bg-bg-2 p-0.5", className)}
      {...props}
    />
  )
}

function SegmentedItem({
  selected = false,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & { selected?: boolean }) {
  return (
    <button
      type={type}
      data-slot="segmented-item"
      aria-pressed={selected}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-(length:--t-13) font-medium text-ink-2 transition-(--tp-color-background-color-border-color-box-shadow-opacity) outline-hidden hover:bg-bg-3 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-ink-3 aria-pressed:bg-ink aria-pressed:text-bg-2 aria-pressed:hover:bg-ink aria-pressed:hover:text-bg-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

export { Segmented, SegmentedItem }
