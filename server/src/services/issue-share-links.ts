import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@tickernelz/paperclip-pro-db";
import {
  agents,
  authUsers,
  companies,
  companyLogos,
  heartbeatRuns,
  issueAttachments,
  issueRelations,
  issueShareLinks,
  issueWorkProducts,
  issues,
  projects,
} from "@tickernelz/paperclip-pro-db";
import {
  agentAvatarUrl,
  isSystemIssueDocumentKey,
  isUuidLike,
  issueDocumentKeySchema,
  resolveAgentAppearance,
  ISSUE_SHARE_TOKEN_LENGTH,
  ISSUE_SHARE_TOKEN_PATTERN,
  type IssuePriority,
  type IssueShareLink,
  type IssueStatus,
  type PublicIssueComment,
  type PublicIssueRelatedIssue,
  type PublicIssueShareView,
  type PublicShareActor,
  type PublicShareAttachment,
  type PublicShareWorkProduct,
} from "@tickernelz/paperclip-pro-shared";
import { isUniqueViolation } from "../db-errors.js";
import { assetService } from "./assets.js";
import { documentService } from "./documents.js";
import { issueService } from "./issues.js";
import { createRunSecretRedactionRegistry } from "./run-secret-redaction.js";

const TOKEN_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const TOKEN_BYTE_CEILING = 256 - (256 % TOKEN_ALPHABET.length);
const CREATE_ATTEMPTS = 5;
const PUBLIC_SHARE_PATH = "/api/public/share";

/** Ten base62 characters from crypto.randomBytes with rejection sampling (no modulo bias). */
export function generateIssueShareToken(): string {
  let token = "";
  while (token.length < ISSUE_SHARE_TOKEN_LENGTH) {
    for (const byte of randomBytes(ISSUE_SHARE_TOKEN_LENGTH * 2)) {
      if (byte >= TOKEN_BYTE_CEILING) continue;
      token += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
      if (token.length === ISSUE_SHARE_TOKEN_LENGTH) break;
    }
  }
  return token;
}

type ShareLinkRow = typeof issueShareLinks.$inferSelect;

export function toIssueShareLink(row: ShareLinkRow, baseUrl: string): IssueShareLink {
  return {
    id: row.id,
    issueId: row.issueId,
    token: row.token,
    url: `${baseUrl.replace(/\/+$/, "")}/s/${row.token}`,
    createdAt: row.createdAt.toISOString(),
    createdByAgentId: row.createdByAgentId ?? null,
    createdByUserId: row.createdByUserId ?? null,
  };
}

const shareIssueColumns = {
  id: issues.id,
  companyId: issues.companyId,
  identifier: issues.identifier,
  title: issues.title,
  description: issues.description,
  status: issues.status,
  priority: issues.priority,
  projectId: issues.projectId,
  parentId: issues.parentId,
  assigneeAgentId: issues.assigneeAgentId,
  assigneeUserId: issues.assigneeUserId,
  executionRunId: issues.executionRunId,
  createdAt: issues.createdAt,
  updatedAt: issues.updatedAt,
  completedAt: issues.completedAt,
  hiddenAt: issues.hiddenAt,
};

export type ShareIssue = {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  projectId: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  executionRunId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  hiddenAt: Date | null;
};

export type ResolvedIssueShare = { link: ShareLinkRow; root: ShareIssue };

type RelatedEntry = { issue: ShareIssue; relation: PublicIssueRelatedIssue["relation"] };

type ClassifiableComment = {
  authorType?: string | null;
  authorAgentId?: string | null;
  authorUserId?: string | null;
  derivedAuthorAgentId?: string | null;
  publicShareVisible?: boolean | null;
  presentation?: unknown;
  deletedAt?: Date | string | null;
};

const RELATION_ORDER: Record<PublicIssueRelatedIssue["relation"], number> = {
  parent: 0,
  child: 1,
  blocked_by: 2,
  blocks: 3,
};

function iso(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function presentationKind(presentation: unknown): string | null {
  if (!presentation || typeof presentation !== "object") return null;
  const kind = (presentation as { kind?: unknown }).kind;
  return typeof kind === "string" ? kind : null;
}

/** Public form of a comment under the share rules: full, placeholder, or omitted (null). */
export function classifySharedComment(comment: ClassifiableComment): "comment" | "redacted" | null {
  if (comment.deletedAt) return null;
  if (presentationKind(comment.presentation) === "system_notice") return null;
  const authorType =
    comment.authorType ?? (comment.authorAgentId ? "agent" : comment.authorUserId ? "user" : "system");
  if (authorType === "system") return null;
  if (authorType === "agent" || comment.derivedAuthorAgentId) return "comment";
  if (authorType !== "user") return null;
  return comment.publicShareVisible ? "comment" : "redacted";
}

function httpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  return /^https?:\/\//i.test(value.trim()) ? value.trim() : null;
}

function readAttachmentId(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as { attachmentId?: unknown }).attachmentId;
  return typeof value === "string" && isUuidLike(value) ? value : null;
}

function sharePath(token: string, suffix: string) {
  return `${PUBLIC_SHARE_PATH}/${token}${suffix}`;
}

export function issueShareLinkService(db: Db) {
  const issuesSvc = issueService(db);
  const documentsSvc = documentService(db);
  const assetsSvc = assetService(db);
  const runRedactions = createRunSecretRedactionRegistry(db);

  async function getActive(issueId: string) {
    return db
      .select()
      .from(issueShareLinks)
      .where(and(eq(issueShareLinks.issueId, issueId), isNull(issueShareLinks.revokedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
  }

  async function companyRunId(companyId: string, runId: string | null | undefined) {
    if (!runId || !isUuidLike(runId)) return null;
    const row = await db
      .select({ id: heartbeatRuns.id })
      .from(heartbeatRuns)
      .where(and(eq(heartbeatRuns.id, runId), eq(heartbeatRuns.companyId, companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return row?.id ?? null;
  }

  async function create(input: {
    issue: { id: string; companyId: string };
    actor: { agentId: string | null; userId: string | null; runId: string | null };
  }): Promise<{ link: ShareLinkRow; created: boolean }> {
    const createdByRunId = await companyRunId(input.issue.companyId, input.actor.runId);
    for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt += 1) {
      const existing = await getActive(input.issue.id);
      if (existing) return { link: existing, created: false };
      try {
        const [link] = await db
          .insert(issueShareLinks)
          .values({
            companyId: input.issue.companyId,
            issueId: input.issue.id,
            token: generateIssueShareToken(),
            createdByAgentId: input.actor.agentId,
            createdByUserId: input.actor.userId,
            createdByRunId,
          })
          .returning();
        return { link: link!, created: true };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
    }
    throw new Error("Could not allocate an issue share link");
  }

  async function revoke(input: {
    issueId: string;
    actor: { agentId: string | null; userId: string | null };
  }) {
    return db
      .update(issueShareLinks)
      .set({
        revokedAt: new Date(),
        revokedByAgentId: input.actor.agentId,
        revokedByUserId: input.actor.userId,
      })
      .where(and(eq(issueShareLinks.issueId, input.issueId), isNull(issueShareLinks.revokedAt)))
      .returning()
      .then((rows) => rows[0] ?? null);
  }

  async function resolve(token: string): Promise<ResolvedIssueShare | null> {
    if (!ISSUE_SHARE_TOKEN_PATTERN.test(token)) return null;
    const link = await db
      .select()
      .from(issueShareLinks)
      .where(and(eq(issueShareLinks.token, token), isNull(issueShareLinks.revokedAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!link) return null;
    const root = await db
      .select(shareIssueColumns)
      .from(issues)
      .where(and(eq(issues.id, link.issueId), eq(issues.companyId, link.companyId), isNull(issues.hiddenAt)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return root ? { link, root } : null;
  }

  async function relatedOf(issue: ShareIssue): Promise<RelatedEntry[]> {
    const relations = await db
      .select({ issueId: issueRelations.issueId, relatedIssueId: issueRelations.relatedIssueId })
      .from(issueRelations)
      .where(and(
        eq(issueRelations.companyId, issue.companyId),
        eq(issueRelations.type, "blocks"),
        or(eq(issueRelations.issueId, issue.id), eq(issueRelations.relatedIssueId, issue.id)),
      ));
    const blockers = new Set(relations.filter((row) => row.relatedIssueId === issue.id).map((row) => row.issueId));
    const blocked = new Set(relations.filter((row) => row.issueId === issue.id).map((row) => row.relatedIssueId));
    const ids = [...new Set([...(issue.parentId ? [issue.parentId] : []), ...blockers, ...blocked])];
    const rows = await db
      .select(shareIssueColumns)
      .from(issues)
      .where(and(
        eq(issues.companyId, issue.companyId),
        isNull(issues.hiddenAt),
        ids.length > 0 ? or(eq(issues.parentId, issue.id), inArray(issues.id, ids)) : eq(issues.parentId, issue.id),
      ));
    const entries: RelatedEntry[] = [];
    for (const row of rows) {
      if (row.id === issue.id) continue;
      if (row.id === issue.parentId) entries.push({ issue: row, relation: "parent" });
      if (row.parentId === issue.id) entries.push({ issue: row, relation: "child" });
      if (blockers.has(row.id)) entries.push({ issue: row, relation: "blocked_by" });
      if (blocked.has(row.id)) entries.push({ issue: row, relation: "blocks" });
    }
    return entries.sort((left, right) =>
      RELATION_ORDER[left.relation] - RELATION_ORDER[right.relation]
      || (left.issue.identifier ?? left.issue.title).localeCompare(right.issue.identifier ?? right.issue.title));
  }

  /** The shared issue plus every issue one hop away; downloads and related views must stay inside it. */
  async function oneHopIssues(resolved: ResolvedIssueShare): Promise<Map<string, ShareIssue>> {
    const set = new Map<string, ShareIssue>([[resolved.root.id, resolved.root]]);
    for (const entry of await relatedOf(resolved.root)) set.set(entry.issue.id, entry.issue);
    return set;
  }

  async function agentActors(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, PublicShareActor>();
    const rows = await db
      .select({ id: agents.id, name: agents.name, appearance: agents.appearance })
      .from(agents)
      .where(inArray(agents.id, unique));
    return new Map(rows.map((row) => [row.id, {
      kind: "agent" as const,
      name: row.name,
      iconUrl: agentAvatarUrl(resolveAgentAppearance(row.appearance, row.id)),
    }]));
  }

  async function userActors(ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return new Map<string, PublicShareActor>();
    const rows = await db
      .select({ id: authUsers.id, name: authUsers.name, image: authUsers.image })
      .from(authUsers)
      .where(inArray(authUsers.id, unique));
    return new Map(rows.map((row) => [row.id, {
      kind: "user" as const,
      name: row.name,
      iconUrl: httpUrl(row.image),
    }]));
  }

  async function activeRunFor(issue: ShareIssue) {
    const columns = {
      agentId: heartbeatRuns.agentId,
      status: heartbeatRuns.status,
      startedAt: heartbeatRuns.startedAt,
      createdAt: heartbeatRuns.createdAt,
      issueId: sql<string | null>`${heartbeatRuns.contextSnapshot} ->> 'issueId'`,
    };
    let run = issue.executionRunId
      ? await db
          .select(columns)
          .from(heartbeatRuns)
          .where(and(eq(heartbeatRuns.id, issue.executionRunId), eq(heartbeatRuns.companyId, issue.companyId)))
          .limit(1)
          .then((rows) => rows[0] ?? null)
      : null;
    if (run && ((run.status !== "queued" && run.status !== "running") || run.issueId !== issue.id)) run = null;
    if (!run && issue.assigneeAgentId && issue.status === "in_progress") {
      const candidate = await db
        .select(columns)
        .from(heartbeatRuns)
        .where(and(
          eq(heartbeatRuns.companyId, issue.companyId),
          eq(heartbeatRuns.agentId, issue.assigneeAgentId),
          eq(heartbeatRuns.status, "running"),
        ))
        .orderBy(desc(heartbeatRuns.startedAt))
        .limit(1)
        .then((rows) => rows[0] ?? null);
      if (candidate?.issueId === issue.id) run = candidate;
    }
    return run;
  }

  async function companyProjection(companyId: string, token: string) {
    const row = await db
      .select({ name: companies.name, logoAssetId: companyLogos.assetId })
      .from(companies)
      .leftJoin(companyLogos, eq(companyLogos.companyId, companies.id))
      .where(eq(companies.id, companyId))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return {
      name: row?.name ?? "",
      logoUrl: row?.logoAssetId ? sharePath(token, `/assets/${row.logoAssetId}/content`) : null,
    };
  }

  async function buildView(resolved: ResolvedIssueShare, target: ShareIssue): Promise<PublicIssueShareView> {
    const token = resolved.link.token;
    const isSharedRoot = target.id === resolved.root.id;
    const [related, comments, attachments, documents, workProducts, run, company, project] = await Promise.all([
      relatedOf(target),
      issuesSvc.listComments(target.id, { order: "asc" }),
      issuesSvc.listAttachments(target.id),
      documentsSvc.listIssueDocuments(target.id),
      db
        .select({
          id: issueWorkProducts.id,
          type: issueWorkProducts.type,
          provider: issueWorkProducts.provider,
          title: issueWorkProducts.title,
          status: issueWorkProducts.status,
          url: issueWorkProducts.url,
          metadata: issueWorkProducts.metadata,
        })
        .from(issueWorkProducts)
        .where(and(eq(issueWorkProducts.issueId, target.id), eq(issueWorkProducts.companyId, target.companyId)))
        .orderBy(desc(issueWorkProducts.isPrimary), desc(issueWorkProducts.updatedAt)),
      activeRunFor(target),
      companyProjection(target.companyId, token),
      target.projectId
        ? db
            .select({ name: projects.name })
            .from(projects)
            .where(and(eq(projects.id, target.projectId), eq(projects.companyId, target.companyId)))
            .limit(1)
            .then((rows) => rows[0] ?? null)
        : Promise.resolve(null),
    ]);

    const shown = comments
      .map((comment) => ({ comment, form: classifySharedComment(comment) }))
      .filter((entry): entry is { comment: (typeof comments)[number]; form: "comment" | "redacted" } => entry.form !== null);
    const agentIds = [
      ...shown.flatMap(({ comment }) => {
        const id = comment.authorAgentId ?? comment.derivedAuthorAgentId;
        return id ? [id] : [];
      }),
      ...(target.assigneeAgentId ? [target.assigneeAgentId] : []),
      ...(run ? [run.agentId] : []),
    ];
    const userIds = [
      ...shown.flatMap(({ comment }) => (comment.authorUserId ? [comment.authorUserId] : [])),
      ...(target.assigneeUserId ? [target.assigneeUserId] : []),
    ];
    const [agentsById, usersById] = await Promise.all([agentActors(agentIds), userActors(userIds)]);

    const toAttachment = (attachment: (typeof attachments)[number]): PublicShareAttachment => ({
      id: attachment.id,
      filename: attachment.originalFilename ?? "attachment",
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      url: sharePath(token, `/attachments/${attachment.id}/content`),
    });
    const chronological = [...attachments].sort((left, right) => iso(left.createdAt).localeCompare(iso(right.createdAt)));
    const attachmentsByComment = new Map<string, PublicShareAttachment[]>();
    for (const attachment of chronological) {
      if (!attachment.issueCommentId) continue;
      const list = attachmentsByComment.get(attachment.issueCommentId) ?? [];
      list.push(toAttachment(attachment));
      attachmentsByComment.set(attachment.issueCommentId, list);
    }

    const authorOf = (comment: (typeof comments)[number]): PublicShareActor => {
      const agentId = comment.authorAgentId ?? comment.derivedAuthorAgentId;
      if (agentId && (comment.authorType === "agent" || comment.derivedAuthorAgentId)) {
        return agentsById.get(agentId) ?? { kind: "agent", name: "Agent", iconUrl: null };
      }
      return (comment.authorUserId ? usersById.get(comment.authorUserId) : undefined)
        ?? { kind: "user", name: "Team member", iconUrl: null };
    };

    const publicComments: PublicIssueComment[] = shown.map(({ comment, form }) =>
      form === "comment"
        ? {
            id: comment.id,
            kind: "comment",
            author: authorOf(comment),
            body: comment.body,
            attachments: attachmentsByComment.get(comment.id) ?? [],
            createdAt: iso(comment.createdAt),
          }
        : {
            id: comment.id,
            kind: "redacted",
            author: authorOf(comment),
            createdAt: iso(comment.createdAt),
          });

    const attachmentsById = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    const publicWorkProducts: PublicShareWorkProduct[] = workProducts.map((product) => {
      const attachmentId = product.type === "artifact" && product.provider === "paperclip"
        ? readAttachmentId(product.metadata)
        : null;
      const backing = attachmentId ? attachmentsById.get(attachmentId) : undefined;
      return {
        id: product.id,
        type: product.type,
        title: product.title,
        status: product.status,
        url: httpUrl(product.url),
        downloadUrl: backing ? sharePath(token, `/assets/${backing.assetId}/content`) : null,
      };
    });

    const assignee = target.assigneeAgentId
      ? agentsById.get(target.assigneeAgentId) ?? null
      : target.assigneeUserId
        ? usersById.get(target.assigneeUserId) ?? null
        : null;
    const runAgent = run ? agentsById.get(run.agentId) : undefined;

    const view: PublicIssueShareView = {
      company,
      issue: {
        id: target.id,
        identifier: target.identifier ?? null,
        title: target.title,
        description: target.description ?? null,
        status: target.status as IssueStatus,
        priority: target.priority as IssuePriority,
        projectName: project?.name ?? null,
        assignee,
        createdAt: iso(target.createdAt),
        updatedAt: iso(target.updatedAt),
        completedAt: target.completedAt ? iso(target.completedAt) : null,
      },
      isSharedRoot,
      activeRun: run && runAgent
        ? { agentName: runAgent.name, startedAt: iso(run.startedAt ?? run.createdAt) }
        : null,
      related: related.map((entry) => ({
        id: entry.issue.id,
        identifier: entry.issue.identifier ?? null,
        title: entry.issue.title,
        status: entry.issue.status as IssueStatus,
        relation: entry.relation,
        navigable: isSharedRoot || entry.issue.id === resolved.root.id,
      })),
      comments: publicComments,
      documents: documents.map((document) => ({
        key: document.key,
        title: document.title ?? null,
        body: document.body ?? "",
        updatedAt: iso(document.updatedAt),
        pdfUrl: sharePath(token, `/issues/${target.id}/documents/${encodeURIComponent(document.key)}/pdf`),
      })),
      attachments: chronological.filter((attachment) => !attachment.issueCommentId).map(toAttachment),
      workProducts: publicWorkProducts,
    };
    return runRedactions.redactForIssue(target.companyId, target.id, view);
  }

  async function findVisibleAttachment(resolved: ResolvedIssueShare, attachmentId: string) {
    if (!isUuidLike(attachmentId)) return null;
    const attachment = await issuesSvc.getAttachmentById(attachmentId);
    if (!attachment || attachment.companyId !== resolved.link.companyId) return null;
    const set = await oneHopIssues(resolved);
    if (!set.has(attachment.issueId)) return null;
    if (!attachment.issueCommentId) return attachment;
    const comment = await issuesSvc.getComment(attachment.issueCommentId);
    if (!comment || comment.issueId !== attachment.issueId) return null;
    return classifySharedComment(comment) === "comment" ? attachment : null;
  }

  async function findVisibleAsset(resolved: ResolvedIssueShare, assetId: string) {
    if (!isUuidLike(assetId)) return null;
    const asset = await assetsSvc.getById(assetId);
    if (!asset || asset.companyId !== resolved.link.companyId) return null;
    const logo = await db
      .select({ id: companyLogos.id })
      .from(companyLogos)
      .where(and(eq(companyLogos.companyId, resolved.link.companyId), eq(companyLogos.assetId, assetId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (logo) return asset;
    const attachment = await db
      .select({ id: issueAttachments.id, issueId: issueAttachments.issueId })
      .from(issueAttachments)
      .where(and(eq(issueAttachments.assetId, assetId), eq(issueAttachments.companyId, resolved.link.companyId)))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    if (!attachment) return null;
    const set = await oneHopIssues(resolved);
    if (!set.has(attachment.issueId)) return null;
    const product = await db
      .select({ id: issueWorkProducts.id })
      .from(issueWorkProducts)
      .where(and(
        eq(issueWorkProducts.companyId, resolved.link.companyId),
        eq(issueWorkProducts.issueId, attachment.issueId),
        eq(issueWorkProducts.type, "artifact"),
        eq(issueWorkProducts.provider, "paperclip"),
        sql`${issueWorkProducts.metadata} ->> 'attachmentId' = ${attachment.id}`,
      ))
      .orderBy(asc(issueWorkProducts.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    return product ? asset : null;
  }

  async function findVisibleDocument(resolved: ResolvedIssueShare, issueId: string, rawKey: string) {
    const key = issueDocumentKeySchema.safeParse(rawKey.trim().toLowerCase());
    if (!key.success || isSystemIssueDocumentKey(key.data)) return null;
    const set = await oneHopIssues(resolved);
    const issue = set.get(issueId);
    if (!issue) return null;
    const document = await documentsSvc.getIssueDocumentByKey(issue.id, key.data);
    if (!document) return null;
    return { issue, document: await runRedactions.redactForIssue(issue.companyId, issue.id, document) };
  }

  return {
    getActive,
    create,
    revoke,
    resolve,
    oneHopIssues,
    buildView,
    findVisibleAttachment,
    findVisibleAsset,
    findVisibleDocument,
  };
}
