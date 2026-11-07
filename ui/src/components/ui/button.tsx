import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2 } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border text-(length:--t-13) font-medium transition-(--tp-color-background-color-border-color-box-shadow-opacity) outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:border-line-strong disabled:bg-bg-3 disabled:text-ink-3 aria-busy:cursor-progress data-[active=true]:border-accent data-[active=true]:bg-accent-soft data-[active=true]:text-accent [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 aria-invalid:border-bad",
  {
    variants: {
      variant: {
        primary: "border-transparent bg-accent text-accent-ink hover:bg-accent-hover active:bg-accent-press",
        secondary: "border-line-strong bg-bg-2 text-ink hover:bg-bg-3 active:bg-line-soft",
        ghost:
          "border-transparent bg-transparent text-ink-2 hover:bg-bg-3 hover:text-ink active:bg-line-soft disabled:border-transparent disabled:bg-transparent data-[active=true]:border-transparent data-[state=open]:bg-bg-3 data-[state=open]:text-ink",
        danger: "border-line-strong bg-bg-2 text-bad hover:bg-bg-3 active:bg-line-soft",
        delete: "border-transparent bg-bad text-accent-ink hover:bg-bad-hover active:bg-bad-hover",
        link:
          "border-transparent bg-transparent text-accent underline underline-offset-4 hover:text-accent-hover active:text-accent-press disabled:border-transparent disabled:bg-transparent",
      },
      size: {
        default: "h-10 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-9 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-10",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-9",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    active?: boolean
  }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  className,
  variant = "primary",
  size = "default",
  asChild = false,
  loading = false,
  active,
  children,
  onClick,
  ...props
}, ref) {
  const Comp = asChild ? Slot.Root : "button"
  const handleClick = loading
    ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()
    : onClick

  return (
    <Comp
      ref={ref}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      data-active={active || undefined}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      onClick={handleClick}
      {...props}
    >
      {loading && !asChild ? (
        <>
          <Loader2 aria-hidden="true" className="animate-spin" />
          {children}
        </>
      ) : (
        children
      )}
    </Comp>
  )
})

Button.displayName = "Button"

export { Button, buttonVariants }
