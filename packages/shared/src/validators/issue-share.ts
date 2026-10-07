import { z } from "zod";

export const updateIssueCommentPublicShareSchema = z.object({
  visible: z.boolean(),
}).strict();

export type UpdateIssueCommentPublicShare = z.infer<typeof updateIssueCommentPublicShareSchema>;
