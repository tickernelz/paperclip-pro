UPDATE "project_workspaces"
SET "cwd" = NULL
WHERE "cwd" = '/__paperclip_repo_only__';--> statement-breakpoint
UPDATE "execution_workspaces"
SET "cwd" = NULL
WHERE "cwd" = '/__paperclip_repo_only__';
