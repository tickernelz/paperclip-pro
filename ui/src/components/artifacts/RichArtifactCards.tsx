import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import {
  ArrowRight,
  CircleCheck,
  CircleHelp,
  Clock,
  ExternalLink,
  File,
  FileText,
  Film,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Globe,
  Image as ImageIcon,
  Table2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { artifactPreviewUrl, artifactUrl } from "@/lib/artifact-card-data";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

// Renderers contain UI labels only. All artifact-specific content is passed in.
// Example values live exclusively in the individual stories' args.
export interface ArtifactIdentity {
  title: string;
  summary: string;
  author: string;
  updatedAt: string;
  statusBadge?: ReactNode;
}

function Identity({
  title,
  summary,
}: Pick<ArtifactIdentity, "title" | "summary">) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="break-words text-lg font-semibold leading-snug">
        {title}
      </h2>
      {summary && (
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-3">
          {summary}
        </p>
      )}
    </div>
  );
}

function Footer({
  author,
  updatedAt,
  action,
  statusBadge,
}: Pick<ArtifactIdentity, "author" | "updatedAt" | "statusBadge"> & {
  action: ReactNode;
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
      <span className="text-xs text-ink-3">
        {[author, updatedAt].filter(Boolean).join(" · ")}
      </span>
      {statusBadge}
      {action}
    </footer>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <article className="w-full overflow-hidden rounded-lg border border-line bg-bg-2 text-ink">
      {children}
    </article>
  );
}

function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  return url ? (
    <Button variant="secondary" size="sm" asChild>
      <a href={url} target="_blank" rel="noreferrer">
        {children}
        <ExternalLink className="size-3" />
      </a>
    </Button>
  ) : (
    <Button variant="secondary" size="sm" disabled>
      {children}
    </Button>
  );
}

function Viewer({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          {action}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-dvh overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="pr-6">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

interface DiffProps {
  additions?: number | null;
  deletions?: number | null;
  filesChanged?: number | null;
}
function Diff({ additions, deletions, filesChanged }: DiffProps) {
  return (
    <div className="flex flex-wrap gap-2 font-mono text-xs">
      {additions != null && (
        <span className="text-(--status-task-icon-done)">
          +{additions.toLocaleString("en-US")}
        </span>
      )}
      {deletions != null && (
        <span className="text-(--status-task-icon-blocked)">
          −{deletions.toLocaleString("en-US")}
        </span>
      )}
      {filesChanged != null && (
        <span className="text-ink-3">
          {filesChanged} {filesChanged === 1 ? "file" : "files"}
        </span>
      )}
    </div>
  );
}

export interface PullRequestCardProps extends ArtifactIdentity, DiffProps {
  number?: number | null;
  repository: string;
  sourceBranch: string;
  targetBranch: string;
  state: "open" | "draft" | "merged" | "closed" | "unknown";
  checks: "passed" | "pending" | "failed" | "unknown";
  evidenceSource: string;
  reviewSummary: string;
  url: string;
}

const checksLabel = {
  passed: "Checks passed",
  pending: "Checks pending",
  failed: "Checks failed",
  unknown: "Checks not available",
};
const stateLabel = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
  unknown: "State unknown",
};

export function PullRequestCard(props: PullRequestCardProps) {
  const {
    number,
    repository,
    sourceBranch,
    targetBranch,
    state,
    checks,
    evidenceSource,
    reviewSummary,
    url,
  } = props;
  const CheckIcon = {
    passed: CircleCheck,
    pending: Clock,
    failed: TriangleAlert,
    unknown: CircleHelp,
  }[checks];
  const checkTone = {
    passed: "text-(--status-task-icon-done)",
    pending: "text-ink-3",
    failed: "text-(--status-task-icon-blocked)",
    unknown: "text-ink-3",
  }[checks];
  return (
    <Card>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <GitPullRequest className="size-4" /> Pull request{" "}
            {number != null && <span className="font-mono">#{number}</span>}
          </span>
          <Badge
            variant="outline"
            className={
              state === "merged"
                ? "text-(--status-task-icon-done)"
                : "text-ink-3"
            }
          >
            {state === "merged" && <GitMerge className="size-3" />}
            {stateLabel[state]}
          </Badge>
        </div>
        <Identity {...props} />
        <div className="flex flex-col gap-2 text-xs text-ink-3">
          <span>{repository}</span>
          {(sourceBranch || targetBranch) && (
            <div className="flex min-w-0 items-center gap-2">
              <GitBranch className="size-3.5 shrink-0" />
              <code className="min-w-0 truncate" title={sourceBranch}>
                {sourceBranch}
              </code>
              {sourceBranch && targetBranch && (
                <ArrowRight className="size-3.5 shrink-0" />
              )}
              <code className="min-w-0 truncate" title={targetBranch}>
                {targetBranch}
              </code>
            </div>
          )}
        </div>
        <Diff {...props} />
      </div>
      <div className="flex flex-col gap-2 border-t border-line px-5 py-4">
        <span className="flex items-center gap-2 text-xs">
          <CheckIcon className={`size-4 ${checkTone}`} />
          {checksLabel[checks]}
        </span>
        {reviewSummary && (
          <p className="text-xs leading-relaxed">{reviewSummary}</p>
        )}
        {evidenceSource && (
          <p className="text-xs text-ink-3">
            Source: {evidenceSource}
          </p>
        )}
      </div>
      <Footer
        {...props}
        action={<SourceLink url={url}>Open pull request</SourceLink>}
      />
    </Card>
  );
}

export interface CommitCardProps extends ArtifactIdentity, DiffProps {
  sha: string;
  repository: string;
  branch: string;
  url: string;
}
export function CommitCard(props: CommitCardProps) {
  return (
    <Card>
      <div className="flex flex-col gap-4 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <GitCommitHorizontal className="size-4" /> Commit{" "}
          <code title={props.sha}>{props.sha.slice(0, 8)}</code>
        </span>
        <Identity {...props} />
        <span className="break-words text-xs text-ink-3">
          {props.repository}
        </span>
        {props.branch && (
          <span className="flex items-center gap-2 text-xs text-ink-3">
            <GitBranch className="size-3.5" />
            <code className="min-w-0 truncate">{props.branch}</code>
          </span>
        )}
        <Diff {...props} />
      </div>
      <Footer
        {...props}
        action={<SourceLink url={props.url}>View commit</SourceLink>}
      />
    </Card>
  );
}

function Markdown({ body }: { body: string }) {
  return (
    <div className="flex flex-col gap-3 text-sm leading-relaxed">
      <ReactMarkdown
        components={{
          h1: ({ children }) => (
            <h3 className="text-lg font-semibold">{children}</h3>
          ),
          h2: ({ children }) => (
            <h3 className="text-base font-semibold">{children}</h3>
          ),
          h3: ({ children }) => (
            <h4 className="text-sm font-semibold">{children}</h4>
          ),
          ul: ({ children }) => (
            <ul className="list-disc space-y-1 pl-5">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal space-y-1 pl-5">{children}</ol>
          ),
          img: ({ src, alt }) => {
            const localPreview = artifactPreviewUrl(
              typeof src === "string" ? src : "",
            );
            if (localPreview)
              return (
                <img
                  src={localPreview}
                  alt={alt ?? ""}
                  loading="lazy"
                  className="h-auto max-w-full"
                />
              );
            const href = artifactUrl(typeof src === "string" ? src : "");
            return href ? (
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                {alt || "Open image"}
              </a>
            ) : (
              <span>{alt}</span>
            );
          },
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              {children}
            </a>
          ),
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

export interface DocumentCardProps extends ArtifactIdentity {
  filename: string;
  revision?: number | null;
  body: string;
  onOpen?: () => void;
  expanded?: boolean;
  actions?: ReactNode;
}
export function DocumentCard(props: DocumentCardProps) {
  return (
    <Card>
      {props.body && (
        <div
          className="max-h-52 overflow-hidden border-b border-line bg-bg-3/20 p-5"
          inert
        >
          <Markdown body={props.body.slice(0, 4000)} />
        </div>
      )}
      <div className="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <FileText className="size-4" /> Markdown
          {props.revision != null && ` · revision ${props.revision}`}
        </span>
        <Identity {...props} />
        <span className="break-all font-mono text-xs text-ink-3">
          {props.filename}
        </span>
      </div>
      <Footer
        {...props}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {props.actions}
            {props.onOpen ? (
              <Button
                size="sm"
                variant="secondary"
                aria-expanded={props.expanded}
                onClick={props.onOpen}
              >
                {props.expanded ? "Close document" : "Read document"}
              </Button>
            ) : (
              <Viewer
                title={props.title}
                description={props.filename}
                action="Read document"
              >
                <Markdown body={props.body} />
              </Viewer>
            )}
          </div>
        }
      />
    </Card>
  );
}

export interface DataCardProps extends ArtifactIdentity {
  filename: string;
  columns: string[];
  rows: (string | number)[][];
  truncated?: boolean;
  downloadUrl?: string;
  actions?: ReactNode;
}
function DataTable({ columns, rows }: Pick<DataCardProps, "columns" | "rows">) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {columns.map((column, i) => (
              <th
                key={i}
                className="border-b border-line px-3 py-3 font-medium text-ink-3"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((_, j) => (
                <td key={j} className="border-b border-line/50 px-3 py-3">
                  {row[j] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && (
        <p className="p-4 text-xs text-ink-3">No rows</p>
      )}
    </div>
  );
}
export function DataCard(props: DataCardProps) {
  const csv = [props.columns, ...props.rows]
    .map((row) =>
      row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
    )
    .join("\n");
  return (
    <Card>
      <div className="border-b border-line bg-bg-3/20 px-2">
        <DataTable columns={props.columns} rows={props.rows.slice(0, 3)} />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <Table2 className="size-4" /> CSV · {props.truncated ? "First " : ""}
          {props.rows.length} {props.rows.length === 1 ? "row" : "rows"} ·{" "}
          {props.columns.length}{" "}
          {props.columns.length === 1 ? "column" : "columns"}
        </span>
        <Identity {...props} />
        <span className="break-all font-mono text-xs text-ink-3">
          {props.filename}
        </span>
      </div>
      <Footer
        {...props}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {props.actions}
            <Viewer
              title={props.title}
              description={props.filename}
              action="View data"
            >
              <DataTable {...props} />
              <Button asChild variant="secondary" size="sm" className="w-fit">
                <a
                  download={props.filename}
                  href={
                    props.downloadUrl ||
                    `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
                  }
                >
                  Download CSV
                </a>
              </Button>
            </Viewer>
          </div>
        }
      />
    </Card>
  );
}

function ImageContent({ src, alt }: { src: string; alt: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return src && failedUrl !== src ? (
    <img
      src={src}
      alt={alt}
      onError={() => setFailedUrl(src)}
      loading="lazy"
      className="aspect-video w-full object-contain"
    />
  ) : (
    <div className="flex aspect-video flex-col items-center justify-center gap-3 text-ink-3">
      <ImageIcon className="size-8" />
      <span className="text-xs">No preview available</span>
    </div>
  );
}

export interface ImageCardProps extends ArtifactIdentity {
  filename: string;
  imageUrl: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  onOpen?: () => void;
}
export function ImageCard(props: ImageCardProps) {
  return (
    <Card>
      <div className="border-b border-line bg-bg-3/20">
        <ImageContent src={props.imageUrl} alt={props.alt} />
      </div>
      <div className="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <ImageIcon className="size-4" /> Image
          {props.width && props.height
            ? ` · ${props.width} × ${props.height}`
            : ""}
        </span>
        <Identity {...props} />
        <span className="break-all font-mono text-xs text-ink-3">
          {props.filename}
        </span>
      </div>
      <Footer
        {...props}
        action={
          props.onOpen ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`View image: ${props.title}`}
              onClick={props.onOpen}
            >
              View image
            </Button>
          ) : (
            <Viewer
              title={props.title}
              description={props.filename}
              action="View image"
            >
              <ImageContent src={props.imageUrl} alt={props.alt} />
            </Viewer>
          )
        }
      />
    </Card>
  );
}

export interface VideoCardProps extends ArtifactIdentity {
  filename: string;
  videoUrl: string;
  posterUrl: string;
  duration: string;
  onOpen?: () => void;
}
export function VideoCard(props: VideoCardProps) {
  return (
    <Card>
      <video
        key={props.videoUrl}
        src={props.videoUrl || undefined}
        poster={props.posterUrl || undefined}
        controls
        preload="metadata"
        aria-label={props.title}
        className="aspect-video w-full border-b border-line bg-bg-3"
      />
      <div className="flex flex-col gap-3 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <Film className="size-4" /> Video
          {props.duration && ` · ${props.duration}`}
        </span>
        <Identity {...props} />
        <span className="break-all font-mono text-xs text-ink-3">
          {props.filename}
        </span>
      </div>
      <Footer
        {...props}
        action={
          props.onOpen ? (
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Open video: ${props.title}`}
              onClick={props.onOpen}
            >
              Open video
            </Button>
          ) : (
            <SourceLink url={props.videoUrl}>Open video</SourceLink>
          )
        }
      />
    </Card>
  );
}

export interface LinkPreviewCardProps extends ArtifactIdentity {
  url: string;
  imageUrl: string;
  imageAlt: string;
}
export function LinkPreviewCard(props: LinkPreviewCardProps) {
  return (
    <Card>
      {props.imageUrl && (
        <div className="border-b border-line bg-bg-3/20">
          <ImageContent src={props.imageUrl} alt={props.imageAlt} />
        </div>
      )}
      <div className="flex flex-col gap-4 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <Globe className="size-4" /> Link preview
        </span>
        <Identity {...props} />
        <span className="break-all font-mono text-xs text-ink-3">
          {props.url}
        </span>
      </div>
      <Footer
        {...props}
        action={<SourceLink url={props.url}>Open link</SourceLink>}
      />
    </Card>
  );
}

export interface FileCardProps extends ArtifactIdentity {
  filename: string;
  contentType: string;
  fileSize: string;
  entries: string[];
  downloadUrl: string;
  openUrl?: string;
  actions?: ReactNode;
}
export function FileCard(props: FileCardProps) {
  return (
    <Card>
      <div className="flex flex-col gap-4 p-5">
        <span className="flex items-center gap-2 text-xs text-ink-3">
          <File className="size-4" /> File
          {props.fileSize && ` · ${props.fileSize}`}
        </span>
        <Identity {...props} />
        <div className="flex flex-col gap-1">
          <span className="break-all font-mono text-xs">{props.filename}</span>
          <span className="break-all text-xs text-ink-3">
            {props.contentType}
          </span>
        </div>
        {props.entries.length > 0 && (
          <ul className="flex flex-col gap-2 border-t border-line pt-4">
            {props.entries.map((entry, i) => (
              <li
                key={i}
                className="flex items-center gap-2 font-mono text-xs text-ink-3"
              >
                <FileText className="size-3.5 shrink-0" />
                {entry}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Footer
        {...props}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {props.actions}
            {props.openUrl && (
              <SourceLink url={props.openUrl}>Open file</SourceLink>
            )}
            {props.downloadUrl ? (
              <Button asChild size="sm" variant="secondary">
                <a href={props.downloadUrl} download={props.filename}>
                  Download file
                </a>
              </Button>
            ) : (
              <Button size="sm" variant="secondary" disabled>
                Download unavailable
              </Button>
            )}
          </div>
        }
      />
    </Card>
  );
}
