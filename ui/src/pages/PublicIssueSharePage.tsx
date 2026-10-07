import { useCallback, useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ExternalLink, FileText } from "lucide-react";
import {
  ISSUE_SHARE_TOKEN_PATTERN,
  type PublicIssueComment,
  type PublicIssueRelatedIssue,
  type PublicIssueShareView,
  type PublicShareActor,
  type PublicShareAttachment,
  type PublicShareDocument,
  type PublicShareWorkProduct,
} from "@tickernelz/paperclip-pro-shared";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
  AttachmentTrigger,
} from "@/components/ui/attachment";
import { CompanyPatternIcon } from "@/components/CompanyPatternIcon";
import { Identity } from "@/components/Identity";
import { MarkdownBody } from "@/components/MarkdownBody";
import { IssueStatusBadge } from "@/components/StatusBadge";
import { StatusIcon } from "@/components/StatusIcon";
import { PriorityIcon } from "@/components/PriorityIcon";
import {
  fileKindForAttachment,
  formatFileSize,
} from "@/components/task-chat/task-chat-attachments";
import { issueShareApi } from "../api/issue-share";
import { queryKeys } from "../lib/queryKeys";
import { formatDateTime, relativeTime } from "../lib/utils";

const ACTIVE_RUN_REFETCH_MS = 15_000;

const RELATION_LABELS: Record<PublicIssueRelatedIssue["relation"], string> = {
  parent: "Parent task",
  child: "Sub-task",
  blocked_by: "Blocked by",
  blocks: "Blocks",
};

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.appendChild(meta);
    return () => meta.remove();
  }, []);
}

function sharePath(token: string, issueId?: string) {
  const base = `/s/${encodeURIComponent(token)}`;
  return issueId ? `${base}/issues/${encodeURIComponent(issueId)}` : base;
}

const ATTACHMENT_CONTENT_SRC = /^(?:https?:\/\/[^/]+)?\/api\/attachments\/([^/?#]+)\/content(?:[?#].*)?$/i;

function publicShareImageSrc(token: string, src: string): string | null {
  const match = ATTACHMENT_CONTENT_SRC.exec(src.trim());
  if (!match) return null;
  return `/api/public/share/${encodeURIComponent(token)}/attachments/${match[1]}/content`;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function ActorIdentity({ actor }: { actor: PublicShareActor }) {
  return <Identity name={actor.name} avatarUrl={actor.iconUrl} size="sm" />;
}

function Timestamp({ value }: { value: string }) {
  return (
    <time
      dateTime={value}
      title={formatDateTime(value)}
      className="text-xs text-muted-foreground"
    >
      {relativeTime(value)}
    </time>
  );
}

function ActiveRunPill({ agentName }: { agentName: string }) {
  return (
    <span
      data-testid="public-share-run-pill"
      className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-foreground"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-(--status-agent-running)" aria-hidden />
      {agentName} is working…
    </span>
  );
}

function AttachmentList({ attachments }: { attachments: PublicShareAttachment[] }) {
  return (
    <AttachmentGroup>
      {attachments.map((attachment) => {
        const kind = fileKindForAttachment({
          name: attachment.filename,
          url: attachment.url,
          contentType: attachment.contentType,
          byteSize: attachment.byteSize,
        });
        const KindIcon = kind.icon;
        const size = formatFileSize(attachment.byteSize);
        return (
          <Attachment key={attachment.id} size="sm">
            <AttachmentMedia>
              <KindIcon aria-hidden />
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle className="max-w-48">{attachment.filename}</AttachmentTitle>
              <AttachmentDescription className="max-w-48">
                {size ? `${kind.label} · ${size}` : kind.label}
              </AttachmentDescription>
            </AttachmentContent>
            <AttachmentTrigger
              aria-label={`Download ${attachment.filename}`}
              render={<a href={attachment.url} download={attachment.filename} rel="noreferrer" />}
            />
          </Attachment>
        );
      })}
    </AttachmentGroup>
  );
}

function RelatedIssueRow({
  related,
  token,
  isSharedRoot,
}: {
  related: PublicIssueRelatedIssue;
  token: string;
  isSharedRoot: boolean;
}) {
  const label = related.identifier ? `${related.identifier} · ${related.title}` : related.title;
  const content = (
    <>
      <StatusIcon status={related.status} size="sm" />
      <span className="min-w-0 truncate">{label}</span>
    </>
  );
  return (
    <li className="flex items-center gap-2 text-sm">
      <span className="w-20 shrink-0 text-xs text-muted-foreground">
        {RELATION_LABELS[related.relation]}
      </span>
      {related.navigable ? (
        <Link
          to={isSharedRoot ? sharePath(token, related.id) : sharePath(token)}
          className="flex min-w-0 items-center gap-2 text-foreground underline-offset-2 hover:underline"
        >
          {content}
        </Link>
      ) : (
        <span className="flex min-w-0 items-center gap-2 text-muted-foreground">{content}</span>
      )}
    </li>
  );
}

type ImageSrcResolver = (src: string) => string | null;

function TimelineEntry({ comment, resolveImageSrc }: { comment: PublicIssueComment; resolveImageSrc: ImageSrcResolver }) {
  if (comment.kind === "redacted") {
    return (
      <li
        data-testid="public-share-redacted-comment"
        className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2"
      >
        <ActorIdentity actor={comment.author} />
        <Timestamp value={comment.createdAt} />
        <span className="text-xs italic text-muted-foreground">Internal update</span>
      </li>
    );
  }
  return (
    <li className="space-y-2 rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <ActorIdentity actor={comment.author} />
        <Timestamp value={comment.createdAt} />
      </div>
      <MarkdownBody className="text-sm" softBreaks linkIssueReferences={false} resolveImageSrc={resolveImageSrc}>
        {comment.body}
      </MarkdownBody>
      {comment.attachments.length > 0 ? <AttachmentList attachments={comment.attachments} /> : null}
    </li>
  );
}

function DocumentCard({ document, resolveImageSrc }: { document: PublicShareDocument; resolveImageSrc: ImageSrcResolver }) {
  return (
    <details className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">{document.title ?? document.key}</span>
        <Timestamp value={document.updatedAt} />
      </summary>
      <div className="space-y-3 border-t border-border px-3 py-3">
        <a
          href={document.pdfUrl}
          download
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download PDF
        </a>
        <MarkdownBody className="text-sm" linkIssueReferences={false} resolveImageSrc={resolveImageSrc}>
          {document.body}
        </MarkdownBody>
      </div>
    </details>
  );
}

function WorkProductRow({ product }: { product: PublicShareWorkProduct }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{product.title}</span>
      <span className="text-xs text-muted-foreground">
        {product.type.replace(/_/g, " ")} · {product.status.replace(/_/g, " ")}
      </span>
      {product.url ? (
        <a
          href={product.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open
        </a>
      ) : null}
      {product.downloadUrl ? (
        <a
          href={product.downloadUrl}
          download
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" aria-hidden />
          Download
        </a>
      ) : null}
    </li>
  );
}

function CenteredNotice({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex h-dvh overflow-y-auto bg-background px-4 text-foreground">
      <div className="m-auto w-full max-w-sm space-y-2 rounded-lg border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        {action}
      </div>
    </div>
  );
}

function PublicIssueShareContent({ view, token }: { view: PublicIssueShareView; token: string }) {
  const { company, issue } = view;
  const resolveImageSrc = useCallback((src: string) => publicShareImageSrc(token, src), [token]);
  return (
    <div className="h-dvh overflow-y-auto bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <CompanyPatternIcon
            companyName={company.name}
            logoUrl={company.logoUrl}
            logoFit="contain"
            className="h-8 w-8 shrink-0 rounded-md"
          />
          <span className="min-w-0 truncate text-sm font-medium">{company.name}</span>
          <span className="ml-auto shrink-0 text-xs text-muted-foreground">Read-only view</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-8 px-4 py-5">
        {!view.isSharedRoot ? (
          <Link
            to={sharePath(token)}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to main task
          </Link>
        ) : null}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {issue.identifier ? <span>{issue.identifier}</span> : null}
            {issue.projectName ? <span>{issue.projectName}</span> : null}
          </div>
          <h1 className="break-words text-xl font-semibold">{issue.title}</h1>
          <div className="flex flex-wrap items-center gap-3">
            <IssueStatusBadge status={issue.status} />
            <PriorityIcon priority={issue.priority} showLabel />
            {issue.assignee ? <ActorIdentity actor={issue.assignee} /> : null}
            {view.activeRun ? <ActiveRunPill agentName={view.activeRun.agentName} /> : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Created {formatDateTime(issue.createdAt)} · Updated {relativeTime(issue.updatedAt)}
            {issue.completedAt ? ` · Completed ${formatDateTime(issue.completedAt)}` : ""}
          </p>
        </section>
        {issue.description ? (
          <MarkdownBody className="text-sm" softBreaks linkIssueReferences={false} resolveImageSrc={resolveImageSrc}>
            {issue.description}
          </MarkdownBody>
        ) : null}
        {view.related.length > 0 ? (
          <Section title="Related tasks">
            <ul className="space-y-2">
              {view.related.map((related) => (
                <RelatedIssueRow
                  key={`${related.relation}:${related.id}`}
                  related={related}
                  token={token}
                  isSharedRoot={view.isSharedRoot}
                />
              ))}
            </ul>
          </Section>
        ) : null}
        {view.documents.length > 0 ? (
          <Section title="Documents">
            <div className="space-y-2">
              {view.documents.map((document) => (
                <DocumentCard key={document.key} document={document} resolveImageSrc={resolveImageSrc} />
              ))}
            </div>
          </Section>
        ) : null}
        {view.attachments.length > 0 ? (
          <Section title="Attachments">
            <AttachmentList attachments={view.attachments} />
          </Section>
        ) : null}
        {view.workProducts.length > 0 ? (
          <Section title="Work products">
            <ul className="space-y-2">
              {view.workProducts.map((product) => (
                <WorkProductRow key={product.id} product={product} />
              ))}
            </ul>
          </Section>
        ) : null}
        <Section title="Activity">
          {view.comments.length > 0 ? (
            <ol className="space-y-3">
              {view.comments.map((comment) => (
                <TimelineEntry key={comment.id} comment={comment} resolveImageSrc={resolveImageSrc} />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No updates yet.</p>
          )}
        </Section>
      </main>
    </div>
  );
}

export function PublicIssueSharePage() {
  const { token = "", issueId } = useParams<{ token: string; issueId?: string }>();
  useNoIndexMeta();
  const tokenValid = ISSUE_SHARE_TOKEN_PATTERN.test(token);
  const query = useQuery({
    queryKey: queryKeys.publicShare.view(token, issueId ?? null),
    queryFn: () =>
      issueId ? issueShareApi.getPublicShareIssue(token, issueId) : issueShareApi.getPublicShare(token),
    enabled: tokenValid,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (current) => (current.state.data?.activeRun ? ACTIVE_RUN_REFETCH_MS : false),
  });

  if (!tokenValid || query.data === null) {
    return (
      <CenteredNotice
        title="This link is not available"
        body="It may have been revoked, or the address is incomplete."
      />
    );
  }

  if (query.data) {
    return <PublicIssueShareContent view={query.data} token={token} />;
  }

  if (query.isError) {
    return (
      <CenteredNotice
        title="Couldn't load this page"
        body="Check your connection and try again."
        action={
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="h-dvh overflow-y-auto px-4 py-6" aria-busy="true">
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
