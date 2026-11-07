import { getAdapterDisplay } from "@/adapters/adapter-display-registry";
import { cn } from "@/lib/utils";

const brandMarks: Record<string, { src: string; dark?: string }> = {
  openai_dot: { src: "/brands/adapters/openai-dot.svg" },
  claude_local: { src: "/brands/claude-color.svg" },
  codex_local: { src: "/brands/codex-color.svg" },
  grok_local: { src: "/brands/adapters/grok.svg", dark: "/brands/adapters/grok-dark.svg" },
};
export function AdapterMark({
  type,
  className = "size-6",
}: {
  type: string;
  className?: string;
}) {
  const Icon = getAdapterDisplay(type).icon;
  const mark = brandMarks[type];
  if (!mark) return <Icon className={className} />;
  return (
    <>
      <img
        src={mark.src}
        className={cn(
          "shrink-0 object-contain",
          mark.dark && "dark:hidden",
          className,
        )}
        alt=""
      />
      {mark.dark && (
        <img
          src={mark.dark}
          className={cn("hidden shrink-0 object-contain dark:block", className)}
          alt=""
        />
      )}
    </>
  );
}
