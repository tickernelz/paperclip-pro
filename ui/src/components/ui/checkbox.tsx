"use client"

import * as React from "react"
import { CheckIcon } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer border-line-strong dark:bg-line-strong/30 data-[state=checked]:bg-accent data-[state=checked]:text-accent-ink dark:data-[state=checked]:bg-accent data-[state=checked]:border-accent focus-visible:border-focus focus-visible:ring-focus/50 aria-invalid:ring-bad/20 dark:aria-invalid:ring-bad/40 aria-invalid:border-bad size-4 shrink-0 rounded-(--rad-4) border shadow-xs transition-shadow outline-none focus-visible:ring-(length:--rad-3) disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
