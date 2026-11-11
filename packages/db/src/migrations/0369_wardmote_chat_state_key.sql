DELETE FROM "chat_sdk_state" AS "old"
WHERE "old"."state_key" = 'paperclip:github-webhook-recovery:v1'
  AND EXISTS (
    SELECT 1 FROM "chat_sdk_state" AS "new"
    WHERE "new"."endpoint_id" = "old"."endpoint_id"
      AND "new"."state_key" = 'wardmote:github-webhook-recovery:v1'
  );--> statement-breakpoint
UPDATE "chat_sdk_state"
SET "state_key" = 'wardmote:github-webhook-recovery:v1'
WHERE "state_key" = 'paperclip:github-webhook-recovery:v1';
