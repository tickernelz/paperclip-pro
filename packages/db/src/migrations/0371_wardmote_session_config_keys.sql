UPDATE "agent_task_sessions"
SET "session_params_json" = (
  SELECT jsonb_object_agg(regexp_replace("entry"."key", '^__paperclip', '__wardmote'), "entry"."value" ORDER BY "entry"."key" ~ '^__wardmote')
  FROM jsonb_each("agent_task_sessions"."session_params_json") AS "entry"
)
WHERE jsonb_typeof("session_params_json") = 'object'
  AND "session_params_json"::text ~ '"__paperclip[A-Z][A-Za-z]*":';
