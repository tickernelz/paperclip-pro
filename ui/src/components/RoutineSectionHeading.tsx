import { Copy } from "lucide-react";
import { CopyText } from "./CopyText";

export function RoutineSectionHeading({
  title,
  copyText = null,
}: {
  title: string;
  /** Description markdown to copy. Omit the button when this is null. */
  copyText?: string | null;
}) {
  return (
    <div className="mb-4 flex items-center gap-1">
      <h2 id="routine-section-title" className="text-lg font-semibold">
        {title}
      </h2>
      {copyText != null ? (
        <CopyText
          text={copyText}
          ariaLabel="Copy description"
          title="Copy description"
          copiedLabel="Description copied"
          className="inline-flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-bg-3 hover:text-ink"
        >
          <Copy className="size-3.5" aria-hidden="true" />
        </CopyText>
      ) : null}
    </div>
  );
}
