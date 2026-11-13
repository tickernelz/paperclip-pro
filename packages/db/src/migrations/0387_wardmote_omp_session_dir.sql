UPDATE "agent_task_sessions"
SET "session_params_json" = jsonb_set(
  "session_params_json",
  '{sessionDir}',
  to_jsonb(replace("session_params_json"->>'sessionDir', '/.omp/paperclip/sessions', '/.omp/wardmote/sessions'))
)
WHERE "session_params_json"->>'sessionDir' LIKE '%/.omp/paperclip/sessions%';
