import type { SVGProps } from "react";
import { cn } from "../lib/utils";

const RING = [
  [24, 7],
  [38.72, 15.5],
  [38.72, 32.5],
  [24, 41],
  [9.28, 32.5],
  [9.28, 15.5],
] as const;

const ACCENT_INDEX = 1;
const PULSE_PERIOD_MS = 1200;

interface MootMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  title?: string;
  animated?: boolean;
}

export function MootMark({ title, animated = false, className, ...rest }: MootMarkProps) {
  return (
    <svg
      {...rest}
      className={className}
      viewBox="0 0 48 48"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
    >
      <circle cx="24" cy="24" r="7.4" />
      {RING.map(([cx, cy], index) => (
        <circle
          key={index}
          cx={cx}
          cy={cy}
          r="5.6"
          fill={index === ACCENT_INDEX ? "var(--accent)" : undefined}
          className={cn(animated && "moot-mark-dot-pulse")}
          style={animated ? { animationDelay: `${(((index - ACCENT_INDEX + RING.length) % RING.length) * PULSE_PERIOD_MS) / RING.length - PULSE_PERIOD_MS}ms` } : undefined}
        />
      ))}
    </svg>
  );
}
