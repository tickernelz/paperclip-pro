-- wardmote:migration-safety-ignore full-table-mutation-large-table: completed wake requests are read for human-directed authority, so every row carrying the old key moves (production copy 21839 of 24981 rows in 273 ms)
UPDATE "agent_wakeup_requests"
SET "payload" = jsonb_build_object('_wardmoteWakeContext', "payload" -> '_paperclipWakeContext') || ("payload" - '_paperclipWakeContext')
WHERE "payload" ? '_paperclipWakeContext';
