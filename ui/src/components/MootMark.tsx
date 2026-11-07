import type { SVGProps } from "react";

const RING = [
  [24, 7],
  [38.72, 15.5],
  [38.72, 32.5],
  [24, 41],
  [9.28, 32.5],
  [9.28, 15.5],
] as const;

interface MootMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  title?: string;
}

export function MootMark({ title, className, ...rest }: MootMarkProps) {
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
        <circle key={index} cx={cx} cy={cy} r="5.6" fill={index === 1 ? "var(--accent)" : undefined} />
      ))}
    </svg>
  );
}
