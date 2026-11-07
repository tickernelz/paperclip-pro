import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";

interface MissingPluginTabPlaceholderProps {
  defaultTabHref: string;
  defaultTabLabel: string;
}

export function MissingPluginTabPlaceholder({
  defaultTabHref,
  defaultTabLabel,
}: MissingPluginTabPlaceholderProps) {
  return (
    <div className="rounded-lg border border-dashed border-line bg-bg px-4 py-8 text-sm text-ink-3">
      <div className="flex flex-col items-start gap-3">
        <p>Workspace plugin tab is not available.</p>
        <Button variant="secondary" size="sm" asChild>
          <Link to={defaultTabHref}>{defaultTabLabel}</Link>
        </Button>
      </div>
    </div>
  );
}
