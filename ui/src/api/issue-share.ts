import type {
  IssueComment,
  IssueShareLink,
  PublicIssueShareView,
} from "@tickernelz/paperclip-pro-shared";
import { api, ApiError } from "./client";
import { readApiJson } from "./response";

export type IssueCommentPublicShare = IssueComment & { publicShareVisible: boolean };

const PUBLIC_SHARE_BASE = "/api/public/share";

async function getPublicShareView(path: string): Promise<PublicIssueShareView | null> {
  const res = await fetch(`${PUBLIC_SHARE_BASE}/${path}`, {
    method: "GET",
    credentials: "omit",
    headers: { Accept: "application/json" },
  });
  if (res.status === 404) return null;
  const body = await readApiJson<unknown>(res);
  if (!res.ok) {
    throw new ApiError(
      (body as { error?: string } | null)?.error ?? `Request failed: ${res.status}`,
      res.status,
      body,
    );
  }
  return body as PublicIssueShareView;
}

export const issueShareApi = {
  getShareLink: (issueId: string) =>
    api.get<IssueShareLink | null>(`/issues/${issueId}/share-link`),
  createShareLink: (issueId: string) =>
    api.post<IssueShareLink>(`/issues/${issueId}/share-link`, {}),
  revokeShareLink: (issueId: string) =>
    api.delete<void>(`/issues/${issueId}/share-link`),
  setCommentPublicShare: (issueId: string, commentId: string, visible: boolean) =>
    api.patch<IssueCommentPublicShare>(
      `/issues/${issueId}/comments/${commentId}/public-share`,
      { visible },
    ),
  getPublicShare: (token: string) =>
    getPublicShareView(encodeURIComponent(token)),
  getPublicShareIssue: (token: string, issueId: string) =>
    getPublicShareView(
      `${encodeURIComponent(token)}/issues/${encodeURIComponent(issueId)}`,
    ),
};
