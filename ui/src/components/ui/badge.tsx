import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border border-transparent px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none focus-visible:border-focus focus-visible:ring-focus/50 focus-visible:ring-(length:--rad-3) aria-invalid:ring-bad/20 dark:aria-invalid:ring-bad/40 aria-invalid:border-bad transition-(--tp-color-box-shadow) overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink [a&]:hover:bg-accent/90",
        secondary:
          "bg-bg-3 text-ink [a&]:hover:bg-bg-3/90",
        destructive:
          "bg-bad text-white [a&]:hover:bg-bad/90 focus-visible:ring-bad/20 dark:focus-visible:ring-bad/40 dark:bg-bad/60",
        outline:
          "border-line text-ink [a&]:hover:bg-bg-3 [a&]:hover:text-ink",
        ghost: "[a&]:hover:bg-bg-3 [a&]:hover:text-ink",
        link: "text-accent underline-offset-4 [a&]:hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
