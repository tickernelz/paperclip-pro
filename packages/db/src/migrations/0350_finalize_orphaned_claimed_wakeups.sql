UPDATE "agent_wakeup_requests" AS w
SET "status" = CASE hr."status" WHEN 'succeeded' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' ELSE 'failed' END,
    "finished_at" = COALESCE(w."finished_at", hr."finished_at", now()),
    "error" = COALESCE(w."error", hr."error"),
    "updated_at" = now()
FROM "heartbeat_runs" AS hr
WHERE w."status" = 'claimed'
  AND hr."company_id" = w."company_id"
  AND (hr."id" = w."run_id" OR hr."wakeup_request_id" = w."id")
  AND hr."status" NOT IN ('queued', 'running', 'scheduled_retry');
