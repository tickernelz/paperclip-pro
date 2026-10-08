import { useContext, useEffect, useState, type ComponentProps, type MouseEvent } from "react";
import { PurgedAttachmentsContext } from "../context/PurgedAttachmentsContext";
import {
  isPurgeableContentPath,
  lookupPurgedPath,
  probePurgedContent,
  purgedFileText,
} from "../lib/purged-attachment";
import { cn } from "../lib/utils";

/** Muted placeholder shown where a file removed by retention used to be. */
export function PurgedFileNotice({ purgedAt, className }: { purgedAt: string | Date | null | undefined; className?: string }) {
  return (
    <span
      data-purged-file=""
      className={cn(
        "inline-flex max-w-full rounded-md border border-border bg-muted px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {purgedFileText(purgedAt)}
    </span>
  );
}

type PurgedState = { purgedAt: string | null } | null;

/** Image that swaps itself for a retention tombstone when its attachment was purged. */
export function RetentionAwareImage({ src, onError, ...props }: ComponentProps<"img">) {
  const knownPurged = useContext(PurgedAttachmentsContext);
  const knownPurgedAt = lookupPurgedPath(knownPurged, src);
  const [purged, setPurged] = useState<PurgedState>(null);

  useEffect(() => {
    setPurged(null);
  }, [src]);

  if (knownPurgedAt) return <PurgedFileNotice purgedAt={knownPurgedAt} />;
  if (purged) return <PurgedFileNotice purgedAt={purged.purgedAt} />;

  return (
    <img
      src={src}
      {...props}
      onError={(event) => {
        onError?.(event);
        if (!isPurgeableContentPath(src)) return;
        const probedSrc = src;
        void probePurgedContent(probedSrc).then((result) => {
          if (result) setPurged(result);
        });
      }}
    />
  );
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>) {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

/** Link to attachment content that checks for retention removal before navigating. */
export function RetentionAwareLink({ href, onClick, children, ...props }: ComponentProps<"a">) {
  const knownPurged = useContext(PurgedAttachmentsContext);
  const knownPurgedAt = lookupPurgedPath(knownPurged, href);
  const [purged, setPurged] = useState<PurgedState>(null);

  useEffect(() => {
    setPurged(null);
  }, [href]);

  if (knownPurgedAt) return <PurgedFileNotice purgedAt={knownPurgedAt} />;
  if (purged) return <PurgedFileNotice purgedAt={purged.purgedAt} />;

  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !href || !isPlainLeftClick(event) || !isPurgeableContentPath(href)) return;
        event.preventDefault();
        const pendingTab = props.target === "_blank" ? window.open("about:blank", "_blank") : null;
        if (pendingTab) pendingTab.opener = null;
        void probePurgedContent(href).then((result) => {
          if (result) {
            pendingTab?.close();
            setPurged(result);
            return;
          }
          if (pendingTab) pendingTab.location.href = href;
          else if (props.target === "_blank") window.open(href, "_blank", "noopener,noreferrer");
          else window.location.assign(href);
        });
      }}
    >
      {children}
    </a>
  );
}
