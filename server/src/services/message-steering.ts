import type { Db } from "@tickernelz/paperclip-pro-db";
import { onAdapterSteerTargetRegistered } from "@tickernelz/paperclip-pro-adapter-utils/adapter-steer-registry";

export interface InteractionResponseSteeringScope {
  companyId: string;
  issueId?: string;
  interactionId?: string;
}

export interface PostedCommentSteerRequest {
  companyId: string;
  issueId: string;
  commentId: string;
  actorUserId: string;
}

export interface MessageSteerers {
  interactionResponses(scope?: InteractionResponseSteeringScope): Promise<number>;
  postedComment(request: PostedCommentSteerRequest): Promise<"steered" | "queued">;
  liveRunStarted(runId: string): Promise<void>;
}

const steerers = new Map<Db, MessageSteerers>();
let stopListening: (() => void) | null = null;

function ensureListening() {
  if (stopListening) return;
  stopListening = onAdapterSteerTargetRegistered((runId) => {
    for (const registered of steerers.values()) {
      void registered.liveRunStarted(runId).catch(() => undefined);
    }
  });
}

/** Registers the route-owned steer path so services can steer messages into a live run. */
export function registerMessageSteering(db: Db, value: MessageSteerers): () => void {
  steerers.set(db, value);
  ensureListening();
  return () => {
    if (steerers.get(db) === value) steerers.delete(db);
  };
}

/** Steers every deferred interaction response in scope into its issue's live run. */
export async function steerPendingInteractionResponses(
  db: Db,
  scope?: InteractionResponseSteeringScope,
): Promise<number> {
  const registered = steerers.get(db);
  return registered ? registered.interactionResponses(scope) : 0;
}

/** Steers a comment written outside the comment route with the instance default delivery. */
export async function steerPostedComment(
  db: Db,
  request: PostedCommentSteerRequest,
): Promise<"steered" | "queued"> {
  const registered = steerers.get(db);
  return registered ? registered.postedComment(request) : "queued";
}
