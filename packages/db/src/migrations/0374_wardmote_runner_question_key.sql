UPDATE "issue_thread_interactions"
SET "idempotency_key" = 'wardmote-runner-question:' || substr("idempotency_key", length('paperclip-runner-question:') + 1)
WHERE "idempotency_key" LIKE 'paperclip-runner-question:%';
